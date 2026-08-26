import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TokenChunker } from '@indexa/chunking';
import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { DocumentService } from '../src/services/document-service';

const infraAvailable = Boolean(process.env.DATABASE_URL);

function makeContent(numTokens: number, modifyIndices: Set<number> | undefined, chunkSize: number) {
  const tokens: string[] = [];
  for (let i = 0; i < numTokens; i++) {
    if (modifyIndices?.has(Math.floor(i / chunkSize))) {
      tokens.push(`MODIFIED_${i}_v2`);
    } else {
      tokens.push(`token${i}`);
    }
  }
  return tokens.join(' ');
}

describe.skipIf(!infraAvailable)('Milestone 6 — incremental indexing', () => {
  const chunkSize = 5;
  const chunkOverlap = 0;
  let dbHandle: ReturnType<typeof createDb> | undefined;

  beforeAll(() => {
    if (!infraAvailable) return;
    dbHandle = createDb(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await dbHandle?.sql.end();
  });

  test('100 chunks -> 5 changed -> only 5 re-embedded (critical)', async () => {
    const fake = new FakeEmbeddingProvider({ dimension: 1536 });
    const chunker = new TokenChunker({ chunkSize, chunkOverlap });
    const service = new DocumentService(dbHandle!.db, {
      chunker,
      chunkerConfig: { chunkSize, chunkOverlap },
      embeddingProvider: fake,
      processInline: false,
    });

    const numChunks = 100;
    const numTokens = numChunks * chunkSize;
    const contentV1 = makeContent(numTokens, undefined, chunkSize);

    const first = await service.create({
      filename: `inc-critical-${Date.now()}.txt`,
      content: contentV1,
    });
    await service.processIngestionJob(first.ingestionJob.id);
    expect(fake.totalChunksEmbedded).toBe(100);
    expect(fake.calls).toBe(1); // batched

    const chunksV1 = await service.listChunks(first.document.id);
    expect(chunksV1.length).toBe(100);

    // Modify exactly 5 chunks
    fake.resetCounts();
    const modifySet = new Set([10, 20, 30, 40, 50]);
    const contentV2 = makeContent(numTokens, modifySet, chunkSize);
    const second = await service.reindex(first.document.id, { content: contentV2 });
    await service.processIngestionJob(second.ingestionJob.id);

    // Only 5 chunks should have been embedded
    expect(fake.totalChunksEmbedded).toBe(5);
    expect(fake.calls).toBe(1); // one batched call for the 5 changed

    const chunksV2 = await service.listChunks(second.document.id);
    expect(chunksV2.length).toBe(100);

    // Reused embeddings must be byte-identical
    const v1ByHash = new Map(chunksV1.map((c) => [c.contentHash, c.embedding]));
    let reused = 0;
    for (const c2 of chunksV2) {
      const expectedEmbedding = v1ByHash.get(c2.contentHash);
      if (expectedEmbedding) {
        expect(c2.embedding).toEqual(expectedEmbedding);
        reused++;
      }
    }
    expect(reused).toBe(95);
    expect(chunksV2.filter((c) => v1ByHash.has(c.contentHash!)).length).toBe(95);

    await service.delete(first.document.id);
  });

  test('unchanged chunks reuse embeddings; stale chunks removed from active index', async () => {
    const fake = new FakeEmbeddingProvider({ dimension: 1536 });
    const chunker = new TokenChunker({ chunkSize, chunkOverlap });
    const service = new DocumentService(dbHandle!.db, {
      chunker,
      chunkerConfig: { chunkSize, chunkOverlap },
      embeddingProvider: fake,
      processInline: false,
    });

    const contentV1 = makeContent(20 * chunkSize, undefined, chunkSize);
    const first = await service.create({ filename: `stale-${Date.now()}.txt`, content: contentV1 });
    await service.processIngestionJob(first.ingestionJob.id);
    const v1Chunks = await service.listChunks(first.document.id);
    expect(v1Chunks.length).toBe(20);

    // V2 with fewer tokens => fewer chunks (stale removal)
    // Truncated content: first 10 chunks identical, so they should be reused (0 re-embedded)
    fake.resetCounts();
    const contentV2 = makeContent(10 * chunkSize, undefined, chunkSize);
    const second = await service.reindex(first.document.id, { content: contentV2 });
    await service.processIngestionJob(second.ingestionJob.id);
    const v2Chunks = await service.listChunks(second.document.id);
    expect(v2Chunks.length).toBe(10);
    // Active index is v2's 10; old 20 remain in DB but not returned
    // Since first 10 chunks are identical, they are reused — 0 new embeddings
    expect(fake.totalChunksEmbedded).toBe(0);

    await service.delete(first.document.id);
  });

  test('idempotent retry does not re-embed after completion', async () => {
    const fake = new FakeEmbeddingProvider({ dimension: 1536 });
    const service = new DocumentService(dbHandle!.db, {
      chunkerConfig: { chunkSize, chunkOverlap },
      embeddingProvider: fake,
      processInline: false,
    });
    const { ingestionJob, document } = await service.create({
      filename: `idemp-inc-${Date.now()}.txt`,
      content: makeContent(10 * chunkSize, undefined, chunkSize),
    });
    await service.processIngestionJob(ingestionJob.id);
    const callsAfterFirst = fake.calls;
    fake.resetCounts();
    await service.processIngestionJob(ingestionJob.id); // retry after completed
    expect(fake.calls).toBe(0); // no embedding on idempotent retry
    expect(fake.totalChunksEmbedded).toBe(0);
    await service.delete(document.id);
    void callsAfterFirst;
  });
});

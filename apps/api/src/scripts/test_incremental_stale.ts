import { TokenChunker } from '@indexa/chunking';
import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { loadConfig } from '../config';
import { DocumentService } from '../services/document-service';

const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' } as any);
const { db, sql } = createDb(config.DATABASE_URL);
const fake = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });
const chunker = new TokenChunker({ chunkSize: 5, chunkOverlap: 0 });
const service = new DocumentService(db, {
  chunker,
  chunkerConfig: { chunkSize: 5, chunkOverlap: 0 },
  embeddingProvider: fake,
  processInline: false,
});

function makeTokens(n: number) {
  return Array.from({ length: n }, (_, i) => `t${i}`).join(' ');
}

const contentV1 = makeTokens(20 * 5); // 20 chunks
const first = await service.create({ filename: `stale-${Date.now()}.txt`, content: contentV1 });
await service.processIngestionJob(first.ingestionJob.id);
console.log(`V1 chunks: ${(await service.listChunks(first.document.id)).length}`); // should 20

// V2 with fewer tokens => 10 chunks
const contentV2 = makeTokens(10 * 5);
fake.resetCounts();
const second = await service.reindex(first.document.id, { content: contentV2 });
await service.processIngestionJob(second.ingestionJob.id);
const chunksV2 = await service.listChunks(second.document.id);
console.log(`V2 chunks: ${chunksV2.length} (expected 10)`);
if (chunksV2.length !== 10) {
  console.error('FAIL stale');
  process.exit(1);
}

// Old version's chunks still exist but not active
import { chunks } from '@indexa/db';
import { eq } from 'drizzle-orm';
if (!first.version?.id) throw new Error('first version missing');
const oldVersionChunks = await db
  .select()
  .from(chunks)
  .where(eq(chunks.documentVersionId, first.version.id));
console.log(
  `Old version chunks still in DB: ${oldVersionChunks.length} (should 20, but not active)`,
);
if (oldVersionChunks.length !== 20) {
  console.error('FAIL old count');
  process.exit(1);
}

console.log('PASS stale handling: old chunks not in active index, new active is 10');

await service.delete(first.document.id);
await sql.end();

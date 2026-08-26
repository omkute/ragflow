import { TokenChunker } from '@indexa/chunking';
import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { loadConfig } from '../config';
import { DocumentService } from '../services/document-service';

const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' } as any);
const { db, sql } = createDb(config.DATABASE_URL);
const fake = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });

// Use small chunkSize for controllable chunk count
const chunkSize = 5;
const chunkOverlap = 0;
const chunker = new TokenChunker({ chunkSize, chunkOverlap });

const service = new DocumentService(db, {
  chunker,
  chunkerConfig: { chunkSize, chunkOverlap },
  embeddingProvider: fake,
  processInline: false,
});

function makeContent(numTokens: number, modifyIndices?: Set<number>) {
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

// 20 chunks version 1: need 100 tokens with chunkSize 5
const numChunks = 20;
const numTokens = numChunks * chunkSize;
const contentV1 = makeContent(numTokens);

console.log(`Creating document with ${numChunks} chunks (chunkSize=${chunkSize})...`);
const first = await service.create({ filename: `inc-${Date.now()}.txt`, content: contentV1 });
console.log(
  `First version id ${first.version?.id}, job ${first.ingestionJob.id}, status ${first.version?.status}`,
);
await service.processIngestionJob(first.ingestionJob.id);
console.log(
  `First processed. Fake calls: ${fake.calls}, totalChunksEmbedded: ${fake.totalChunksEmbedded}`,
);
console.log(`CallsLog first batch size: ${fake.callsLog[0]?.inputs.length}`);

if ((fake.totalChunksEmbedded as number) !== numChunks) {
  console.error(`FAIL: expected ${numChunks} embedded, got ${fake.totalChunksEmbedded}`);
  process.exit(1);
}
if (fake.calls !== 1) {
  console.error(`FAIL: expected 1 batch call for first version, got ${fake.calls}`);
  process.exit(1);
}

// Fetch chunks to see embeddings
const chunksV1 = await service.listChunks(first.document.id);
console.log(
  `Chunks V1 count: ${chunksV1.length}, sample hash ${chunksV1[0]?.contentHash.slice(0, 8)} embeddings present: ${!!chunksV1[0]?.embedding}`,
);

// Now modify 2 chunks (e.g., chunk 1 and chunk 5)
const modifySet = new Set([1, 5]);
const contentV2 = makeContent(numTokens, modifySet);
console.log(`\nReindexing with ${modifySet.size} modified chunks...`);
fake.resetCounts();
const second = await service.reindex(first.document.id, { content: contentV2 });
console.log(`Second version ${second.version?.version}, job ${second.ingestionJob.id}`);
await service.processIngestionJob(second.ingestionJob.id);
console.log(
  `Second processed. Fake calls: ${fake.calls}, totalChunksEmbedded: ${fake.totalChunksEmbedded}`,
);
console.log(`CallsLog second batch size: ${fake.callsLog[0]?.inputs.length}`);

if ((fake.totalChunksEmbedded as number) !== modifySet.size) {
  console.error(
    `FAIL: incremental expected ${modifySet.size} re-embedded, got ${fake.totalChunksEmbedded}`,
  );
  process.exit(1);
}
if (fake.calls !== 1) {
  console.error(`FAIL: expected 1 batch call for incremental, got ${fake.calls}`);
  process.exit(1);
}

// Verify embeddings reuse: unchanged chunks should have identical vectors as V1
const chunksV2 = await service.listChunks(second.document.id);
console.log(`Chunks V2 count: ${chunksV2.length}`);
let reused = 0;
for (let i = 0; i < chunksV2.length; i++) {
  const c2 = chunksV2[i]!;
  const c1 = chunksV1.find((c) => c.contentHash === c2.contentHash);
  if (c1?.embedding && c2.embedding) {
    const same = JSON.stringify(c1.embedding) === JSON.stringify(c2.embedding);
    if (!same) {
      console.error(`FAIL: reused hash ${c2.contentHash.slice(0, 8)} embeddings differ!`);
      process.exit(1);
    }
    if (modifySet.has(i)) {
      console.error(`FAIL: modified chunk ${i} should not match previous hash`);
      process.exit(1);
    }
    reused++;
  } else if (!modifySet.has(i)) {
    console.error(`FAIL: expected reused embedding for chunk ${i} but not found`);
    process.exit(1);
  }
}
console.log(
  `Reused chunks verified: ${reused} == ${numChunks - modifySet.size} ? ${reused === numChunks - modifySet.size ? 'PASS' : 'FAIL'}`,
);
if (reused !== numChunks - modifySet.size) {
  console.error('FAIL: reused count mismatch');
  process.exit(1);
}

// Verify new chunks have new embeddings not equal to any old
for (const idx of modifySet) {
  const c2 = chunksV2[idx]!;
  const old = chunksV1[idx]!;
  if (JSON.stringify(c2.embedding) === JSON.stringify(old.embedding)) {
    console.error(`FAIL: modified chunk ${idx} embedding should differ from old`);
    process.exit(1);
  }
}

// Test 100 chunks -> 5 changed (larger scale)
console.log('\n=== Large scale test: 100 chunks, 5 changed ===');
fake.resetCounts();
const bigNumChunks = 100;
const bigTokens = bigNumChunks * chunkSize;
const contentBigV1 = makeContent(bigTokens);
const bigFirst = await service.create({ filename: `big-${Date.now()}.txt`, content: contentBigV1 });
await service.processIngestionJob(bigFirst.ingestionJob.id);
console.log(`Big V1: calls ${fake.calls}, total ${fake.totalChunksEmbedded}`);
fake.resetCounts();
const modifyBig = new Set([10, 20, 30, 40, 50]);
const contentBigV2 = makeContent(bigTokens, modifyBig);
const bigSecond = await service.reindex(bigFirst.document.id, { content: contentBigV2 });
await service.processIngestionJob(bigSecond.ingestionJob.id);
console.log(`Big V2: calls ${fake.calls}, total ${fake.totalChunksEmbedded} (expected 5)`);
if ((fake.totalChunksEmbedded as number) !== 5) {
  console.error(`FAIL: big test expected 5, got ${fake.totalChunksEmbedded}`);
  process.exit(1);
}
console.log('PASS: big test 100->5');

// Cleanup
await service.delete(first.document.id);
await service.delete(bigFirst.document.id);
await sql.end();
console.log('\nAll incremental indexing checks PASSED');

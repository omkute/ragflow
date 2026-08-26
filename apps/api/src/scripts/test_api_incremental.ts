import { createDb } from '@indexa/db';
import { buildApp } from '../app';
import { loadConfig } from '../config';

const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' } as any);
const app = await buildApp(config);
const { db, sql } = createDb(config.DATABASE_URL);

// In test env, processInline = true, so POST returns 201 with immediate ready
function tokens(n: number) {
  return Array.from({ length: n }, (_, i) => `tok${i}`).join(' ');
}
const chunkSize = 5;
const contentV1 = tokens(20 * chunkSize);
console.log('POST /documents v1');
const res1 = await app.inject({
  method: 'POST',
  url: '/documents',
  payload: { filename: `api-inc-${Date.now()}.txt`, content: contentV1 },
});
console.log(`Status ${res1.statusCode}`, res1.json().id ? 'id ok' : 'no id');
console.log(res1.json());
if (![201, 202].includes(res1.statusCode)) {
  console.error('FAIL post');
  process.exit(1);
}
const docId = res1.json().id;
const jobId1 = res1.json().jobId;
console.log(
  `Doc ${docId} job ${jobId1} version ${res1.json().currentVersion} status ${res1.json().status}`,
);

// Check chunks
const chunks1 = await app.inject({ method: 'GET', url: `/documents/${docId}/chunks` });
console.log(`Chunks v1: ${chunks1.json().chunks.length} (expected 20)`);

// Reindex with 2 changed chunks -> need to modify tokens at chunk boundaries
const contentV2 = tokens(20 * chunkSize)
  .replace('tok5', 'MODIFIED5')
  .replace('tok25', 'MODIFIED25');
console.log('\nPOST /documents/:id/reindex');
const res2 = await app.inject({
  method: 'POST',
  url: `/documents/${docId}/reindex`,
  payload: { content: contentV2 },
});
console.log(`Status ${res2.statusCode}`, res2.json());
if (![201, 202].includes(res2.statusCode)) {
  console.error('FAIL reindex');
  process.exit(1);
}
console.log(`Reindexed version ${res2.json().currentVersion} job ${res2.json().jobId}`);

// Wait a bit if queued (test env inline so ready)
const detail = await app.inject({ method: 'GET', url: `/documents/${docId}` });
console.log(
  `Detail after reindex: currentVersion ${detail.json().currentVersion} status ${detail.json().status}`,
);

const chunks2 = await app.inject({ method: 'GET', url: `/documents/${docId}/chunks` });
console.log(`Chunks v2: ${chunks2.json().chunks.length} (expected 20)`);
const c2 = chunks2.json().chunks;
const c1 = chunks1.json().chunks;
let reused = 0;
for (let i = 0; i < c2.length; i++) {
  if (c2[i].contentHash === c1[i].contentHash) reused++;
}
console.log(`Reused chunks via API: ${reused} (expected 18)`);
if (reused !== 18) {
  console.error('FAIL reused API');
  process.exit(1);
}

console.log('PASS API incremental');

// Cleanup
await app.inject({ method: 'DELETE', url: `/documents/${docId}` });
await app.close();
await sql.end();

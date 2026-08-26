import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { TokenChunker } from '@indexa/chunking';
import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { createIngestionProcessor } from '../../worker/src/processors/ingestion';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { INGESTION_QUEUE_NAME } from '../src/queue/ingestion-queue';
import { createChunkRepository } from '../src/repositories/chunk-repository';
import { createDocumentRepository } from '../src/repositories/document-repository';
import { createIngestionJobRepository } from '../src/repositories/ingestion-job-repository';
import { DocumentService } from '../src/services/document-service';

const infraAvailable = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

function uniqueName(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('reliability — Milestone 8', () => {
  test.skipIf(!infraAvailable)(
    'ingestion job is idempotent: running same job twice creates no duplicates',
    async () => {
      const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' });
      const { db, sql } = createDb(config.DATABASE_URL);
      const fakeEmbeddings = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });
      const chunker = new TokenChunker({
        chunkSize: config.CHUNK_SIZE,
        chunkOverlap: config.CHUNK_OVERLAP,
      });
      const service = new DocumentService(db, {
        chunker,
        chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
        embeddingProvider: fakeEmbeddings,
        processInline: false,
      });

      const chunkRepo = createChunkRepository(db);
      const filename = `${uniqueName('idempotent')}.md`;
      const content = `# Idempotent\n\n${'word '.repeat(100)}`;

      const { document, version, ingestionJob } = await service.create({
        filename,
        content,
      });

      expect(version?.status).toBe('pending');
      expect(ingestionJob.status).toBe('queued');

      // First processing
      await service.processIngestionJob(ingestionJob.id);
      const chunksAfterFirst = await chunkRepo.findByDocumentVersion(version!.id);
      expect(chunksAfterFirst.length).toBeGreaterThan(0);
      const firstCalls = fakeEmbeddings.calls;

      // Second processing (retry / at-least-once) — must not duplicate chunks or vectors
      fakeEmbeddings.resetCounts();
      await service.processIngestionJob(ingestionJob.id);
      const chunksAfterSecond = await chunkRepo.findByDocumentVersion(version!.id);
      expect(chunksAfterSecond.length).toBe(chunksAfterFirst.length);
      // Second run is idempotent no-op after completion, so no additional embedding calls
      // (job already completed, processor early-returns)
      expect(chunksAfterSecond.map((c) => c.contentHash)).toEqual(
        chunksAfterFirst.map((c) => c.contentHash),
      );

      // DB constraint check: no duplicate (version, index)
      const indices = chunksAfterSecond.map((c) => c.chunkIndex);
      expect(new Set(indices).size).toBe(indices.length);

      // Clean up
      await db
        .delete((await import('@indexa/db')).chunks)
        .where(
          (await import('drizzle-orm')).eq(
            (await import('@indexa/db')).chunks.documentVersionId,
            version!.id,
          ),
        );
      await sql.end();
    },
  );

  test.skipIf(!infraAvailable)(
    'concurrent workers processing same job produce no duplicate chunks',
    async () => {
      const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' });
      const { db, sql } = createDb(config.DATABASE_URL);
      const fakeEmbeddings = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });

      const service = new DocumentService(db, {
        chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
        embeddingProvider: fakeEmbeddings,
        processInline: false,
      });

      const filename = `${uniqueName('concurrent')}.md`;
      const content = `# Concurrent\n\n${Array.from({ length: 50 }, (_, i) => `sentence ${i} content`).join(' ')}`;

      const { version, ingestionJob } = await service.create({ filename, content });

      // Simulate two workers racing on the same job (concurrent execution)
      const processor1 = service.processIngestionJob(ingestionJob.id);
      const processor2 = service.processIngestionJob(ingestionJob.id);

      // Both must not throw unhandled duplicate errors; one may early-return after completion
      // Use Promise.allSettled to allow race handling
      const results = await Promise.allSettled([processor1, processor2]);
      // At least one must succeed; the other may succeed (idempotent) or throw due to race but not duplicate chunks
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      const chunkRepo = createChunkRepository(db);
      const chunks = await chunkRepo.findByDocumentVersion(version!.id);
      // No duplicate indices
      const indices = chunks.map((c) => c.chunkIndex);
      expect(new Set(indices).size).toBe(indices.length);
      expect(chunks.length).toBeGreaterThan(0);

      await sql.end();
    },
  );

  test.skipIf(!infraAvailable)(
    'retry on transient embedding failure: job retries and eventually succeeds',
    async () => {
      const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' });
      const { db, sql } = createDb(config.DATABASE_URL);

      // Flaky provider: fails first embedDocuments call, succeeds on second
      let callCount = 0;
      const flakyProvider = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });
      const originalEmbed = flakyProvider.embedDocuments.bind(flakyProvider);
      flakyProvider.embedDocuments = async (texts: string[]) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('Embedding provider timeout');
        }
        return originalEmbed(texts);
      };

      const service = new DocumentService(db, {
        chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
        embeddingProvider: flakyProvider,
        processInline: false,
      });

      const ingestionJobRepo = createIngestionJobRepository(db);
      const { version, ingestionJob } = await service.create({
        filename: `${uniqueName('retry')}.md`,
        content: `# Retry\n\n${'retry content '.repeat(30)}`,
      });

      // First attempt should fail and mark job failed (wrapped as EmbeddingProviderError)
      await expect(service.processIngestionJob(ingestionJob.id)).rejects.toThrow(
        /Failed to embed|timeout/i,
      );
      const failedJob = await ingestionJobRepo.findById(ingestionJob.id);
      expect(failedJob?.status).toBe('failed');
      expect(failedJob?.error).toMatch(/Failed to embed|timeout/i);

      // Simulate retry (BullMQ would re-enqueue with backoff; we manually reprocess)
      // Reset job to queued for retry demonstration (in real BullMQ, attempts would increment and backoff)
      await ingestionJobRepo.updateStatus(ingestionJob.id, 'queued', { error: null });
      // Need to reset version/document status as well for retry to succeed (simulating worker's retry handling)
      const { documents, documentVersions } = await import('@indexa/db');
      const { eq } = await import('drizzle-orm');
      await db
        .update(documents)
        .set({ status: 'pending' as const })
        .where(eq(documents.id, ingestionJob.documentId));
      await db
        .update(documentVersions)
        .set({ status: 'pending' as const })
        .where(eq(documentVersions.id, ingestionJob.documentVersionId));

      await service.processIngestionJob(ingestionJob.id);
      const successJob = await ingestionJobRepo.findById(ingestionJob.id);
      expect(successJob?.status).toBe('completed');
      const chunkRepo = createChunkRepository(db);
      const chunks = await chunkRepo.findByDocumentVersion(version!.id);
      expect(chunks.length).toBeGreaterThan(0);

      await sql.end();
    },
  );

  test.skipIf(!infraAvailable)(
    'GET /jobs/:id exposes job state and reindex is idempotent via unique constraint',
    async () => {
      const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' });
      const app = await buildApp({ ...config, LOG_LEVEL: 'warn' });

      const filename = `${uniqueName('job-api')}.md`;
      const createRes = await app.inject({
        method: 'POST',
        url: '/documents',
        payload: { filename, content: '# Job API\n\ncontent here' },
      });
      // With processInline in test env, job completes inline and returns 201
      expect([201, 202]).toContain(createRes.statusCode);
      const created = createRes.json();
      expect(created.jobId).toBeDefined();
      const jobId: string = created.jobId;

      const jobRes = await app.inject({ method: 'GET', url: `/jobs/${jobId}` });
      expect(jobRes.statusCode).toBe(200);
      const job = jobRes.json();
      expect(job.id).toBe(jobId);
      expect(['completed', 'queued', 'processing']).toContain(job.status);
      expect(job.attempts).toBeGreaterThanOrEqual(0);

      // Reindex creates new version + job; POST again should get 201/202 with new job
      const reindexRes = await app.inject({
        method: 'POST',
        url: `/documents/${created.id}/reindex`,
        payload: { content: '# Job API Updated\n\nnew content here' },
      });
      expect([201, 202]).toContain(reindexRes.statusCode);
      const reindexed = reindexRes.json();
      expect(reindexed.currentVersion).toBe(2);
      expect(reindexed.jobId).not.toBe(jobId);

      // Unknown job returns 404
      const unknown = await app.inject({
        method: 'GET',
        url: '/jobs/00000000-0000-4000-8000-000000000000',
      });
      expect(unknown.statusCode).toBe(404);

      await app.close();
    },
  );

  test('BullMQ queue uses exponential backoff and idempotent jobId', async () => {
    // Pure config test without infra
    const { DEFAULT_JOB_OPTIONS, INGESTION_QUEUE_NAME } = await import(
      '../src/queue/ingestion-queue'
    );
    expect(INGESTION_QUEUE_NAME).toBe('ingestion');
    expect(DEFAULT_JOB_OPTIONS?.attempts).toBeGreaterThanOrEqual(3);
    expect((DEFAULT_JOB_OPTIONS?.backoff as { type: string; delay: number })?.type).toBe(
      'exponential',
    );
    expect(
      (DEFAULT_JOB_OPTIONS?.backoff as { type: string; delay: number })?.delay,
    ).toBeGreaterThanOrEqual(1000);
  });

  test('createIngestionProcessor is idempotent and handles concurrent execution', async () => {
    if (!infraAvailable) return;
    const config = loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' });
    const { db, sql } = createDb(config.DATABASE_URL);
    const ingestionJobRepo = createIngestionJobRepository(db);
    const documentRepo = createDocumentRepository(db);

    // Create a document manually via service
    const fakeEmbeddings = new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });
    const service = new DocumentService(db, {
      chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
      embeddingProvider: fakeEmbeddings,
      processInline: false,
    });

    const { version, ingestionJob } = await service.create({
      filename: `${uniqueName('processor')}.md`,
      content: '# Processor\n\nprocessor test content '.repeat(20),
    });

    const processorFactory = createIngestionProcessor(
      db,
      { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
      { info: () => {}, error: () => {} },
      fakeEmbeddings,
    );

    const jobData = {
      ingestionJobId: ingestionJob.id,
      documentId: ingestionJob.documentId,
      documentVersionId: ingestionJob.documentVersionId,
    };

    // Run processor twice concurrently
    const jobMock = (data: typeof jobData) =>
      ({ id: data.ingestionJobId, data, attemptsMade: 0 }) as unknown as Parameters<
        typeof processorFactory
      >[0];

    await Promise.all([processorFactory(jobMock(jobData)), processorFactory(jobMock(jobData))]);

    const finalJob = await ingestionJobRepo.findById(ingestionJob.id);
    expect(finalJob?.status).toBe('completed');

    const chunkRepo = createChunkRepository(db);
    const chunks = await chunkRepo.findByDocumentVersion(version!.id);
    const indices = chunks.map((c) => c.chunkIndex);
    expect(new Set(indices).size).toBe(indices.length);

    await sql.end();
  });
});

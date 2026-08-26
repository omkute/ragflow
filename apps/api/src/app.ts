import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import type { ApiConfig } from './config';
import { registerErrorHandler } from './errors';
import { createIngestionQueue } from './queue/ingestion-queue';
import { createIngestionJobRepository } from './repositories/ingestion-job-repository';
import { createSearchRepository } from './repositories/search-repository';
import { documentsRoutes } from './routes/documents';
import { healthRoutes } from './routes/health';
import { jobsRoutes } from './routes/jobs';
import { searchRoutes } from './routes/search';
import { DocumentService } from './services/document-service';
import { SearchService } from './services/search-service';

/**
 * Build the Fastify application (no listening).
 *
 * Owns infrastructure connections and guarantees cleanup via `app.close()`:
 * tests use `inject()` against the returned instance.
 */
export async function buildApp(config: ApiConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      base: { service: 'api', env: config.NODE_ENV },
    },
  });

  const { db, sql } = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  redis.on('error', (error) => {
    app.log.warn({ err: error.message }, 'Redis connection error');
  });

  const embeddingProvider = new FakeEmbeddingProvider({
    dimension: config.VECTOR_DIMENSION,
  });

  const searchRepository = createSearchRepository(db);
  const searchService = new SearchService({
    embeddingProvider,
    searchRepository,
  });

  const ingestionQueue = createIngestionQueue(redis);
  const ingestionJobRepository = createIngestionJobRepository(db);

  const isTestEnv = config.NODE_ENV === 'test';
  const documentService = new DocumentService(db, {
    chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
    embeddingProvider,
    queue: ingestionQueue,
    processInline: isTestEnv,
  });

  app.register(healthRoutes, { sql, redis });
  app.register(documentsRoutes, { documentService });
  app.register(jobsRoutes, { ingestionJobRepository });
  app.register(searchRoutes, { searchService, defaultTopK: config.DEFAULT_TOP_K });
  registerErrorHandler(app);

  app.addHook('onClose', async () => {
    await ingestionQueue.close().catch(() => {});
    await redis.quit().catch(() => redis.disconnect());
    await sql.end();
  });

  app.log.debug({ dbReady: Boolean(db) }, 'API application built');

  return app;
}

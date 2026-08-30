import cors from '@fastify/cors';
import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider, OpenAIEmbeddingProvider } from '@indexa/embeddings';
import { FakeLLMProvider, OpenAILLMProvider } from '@indexa/llm';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import type { ApiConfig } from './config';
import { registerErrorHandler } from './errors';
import { createIngestionQueue } from './queue/ingestion-queue';
import { createIngestionJobRepository } from './repositories/ingestion-job-repository';
import { createSearchRepository } from './repositories/search-repository';
import { aiSettingsRoutes } from './routes/ai-settings';
import { documentsRoutes } from './routes/documents';
import { generationRoutes } from './routes/generation';
import { healthRoutes } from './routes/health';
import { jobsRoutes } from './routes/jobs';
import { searchRoutes } from './routes/search';
import { DocumentService } from './services/document-service';
import { GenerationService } from './services/generation-service';
import { RuntimeEmbeddingProvider, RuntimeLLMProvider } from './services/runtime-ai-settings';
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

  // CORS for web dashboard (apps/web on :3001)
  await app.register(cors, {
    origin: ['http://127.0.0.1:3001', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type'],
  });

  const { db, sql } = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  redis.on('error', (error) => {
    app.log.warn({ err: error.message }, 'Redis connection error');
  });

  const baseEmbeddingProvider =
    config.EMBEDDING_PROVIDER === 'openai'
      ? new OpenAIEmbeddingProvider({
          apiKey: config.EMBEDDING_API_KEY as string,
          model: config.EMBEDDING_MODEL ?? 'text-embedding-3-small',
          dimension: config.VECTOR_DIMENSION,
        })
      : new FakeEmbeddingProvider({ dimension: config.VECTOR_DIMENSION });

  const runtimeSettings = {
    embeddingProvider: config.EMBEDDING_PROVIDER,
    embeddingModel: config.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    embeddingConfigured: Boolean(config.EMBEDDING_API_KEY) || config.EMBEDDING_PROVIDER === 'fake',
    llmProvider: config.LLM_PROVIDER,
    llmModel: config.LLM_MODEL ?? 'gpt-4o-mini',
    llmConfigured: Boolean(config.LLM_API_KEY) || config.LLM_PROVIDER === 'fake',
  };
  const embeddingProvider = new RuntimeEmbeddingProvider(
    baseEmbeddingProvider,
    runtimeSettings,
    config.EMBEDDING_API_KEY,
  );

  const searchRepository = createSearchRepository(db);
  const searchService = new SearchService({
    embeddingProvider,
    searchRepository,
  });

  const baseLLMProvider =
    config.LLM_PROVIDER === 'openai'
      ? new OpenAILLMProvider({
          apiKey: config.LLM_API_KEY as string,
          model: config.LLM_MODEL ?? 'gpt-4o-mini',
        })
      : new FakeLLMProvider();
  const llmProvider = new RuntimeLLMProvider(baseLLMProvider, runtimeSettings, config.LLM_API_KEY);
  const generationService = new GenerationService({
    searchService,
    llmProvider,
    defaultTopK: config.DEFAULT_TOP_K,
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
  app.register(generationRoutes, { generationService, defaultTopK: config.DEFAULT_TOP_K });
  aiSettingsRoutes(app, { embedding: embeddingProvider, llm: llmProvider });
  registerErrorHandler(app);

  app.addHook('onClose', async () => {
    await ingestionQueue.close().catch(() => {});
    await redis.quit().catch(() => redis.disconnect());
    await sql.end();
  });

  app.log.debug({ dbReady: Boolean(db) }, 'API application built');

  return app;
}

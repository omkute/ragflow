import { createDb } from '@indexa/db';
import Fastify, { type FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import type { ApiConfig } from './config';
import { registerErrorHandler } from './errors';
import { documentsRoutes } from './routes/documents';
import { healthRoutes } from './routes/health';
import { DocumentService } from './services/document-service';

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
    // Keep reconnecting quietly; health endpoint reports actual availability.
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  redis.on('error', (error) => {
    app.log.warn({ err: error.message }, 'Redis connection error');
  });

  app.register(healthRoutes, { sql, redis });
  app.register(documentsRoutes, { documentService: new DocumentService(db) });
  registerErrorHandler(app);

  app.addHook('onClose', async () => {
    await redis.quit().catch(() => redis.disconnect());
    await sql.end();
  });

  app.log.debug({ dbReady: Boolean(db) }, 'API application built');

  return app;
}

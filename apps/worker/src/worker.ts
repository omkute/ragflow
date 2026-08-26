import { createDb } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { Worker } from 'bullmq';
import pino from 'pino';
import { loadConfig } from './config';
import { createRedisConnection } from './jobs/connection';
import { INGESTION_QUEUE_NAME } from './jobs/queues';
import { createIngestionProcessor } from './processors/ingestion';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL, base: { service: 'worker' } });
  const connection = createRedisConnection(config.REDIS_URL);
  const { db, sql } = createDb(config.DATABASE_URL);

  connection.on('error', (error) => {
    logger.warn({ err: error.message }, 'Redis connection error');
  });

  const embeddingProvider = new FakeEmbeddingProvider({
    dimension: config.VECTOR_DIMENSION,
  });

  const processor = createIngestionProcessor(
    db,
    { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
    logger,
    embeddingProvider,
  );

  const worker = new Worker(INGESTION_QUEUE_NAME, processor, {
    connection,
    concurrency: config.WORKER_CONCURRENCY,
    // BullMQ will retry per job options (attempts/backoff) configured at enqueue time.
    // Worker-level lock settings ensure job not lost on crash.
    lockDuration: 30000,
  });

  worker.on('failed', (job, error) => {
    logger.error(
      {
        job_id: job?.id,
        queue: INGESTION_QUEUE_NAME,
        attempts: job?.attemptsMade,
        err: error.message,
      },
      'Job failed',
    );
  });

  worker.on('error', (error) => {
    logger.error({ err: error.message }, 'Worker error');
  });

  logger.info(
    { queue: INGESTION_QUEUE_NAME, concurrency: config.WORKER_CONCURRENCY },
    'Worker started',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await worker.close();
    connection.disconnect();
    await sql.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

try {
  await main();
} catch (error) {
  // Configuration errors surface here as clear startup failures.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

import { Queue, type QueueOptions } from 'bullmq';
import type Redis from 'ioredis';

/** Single ingestion/indexing queue — mirrors worker constant. */
export const INGESTION_QUEUE_NAME = 'ingestion';

export interface IngestionJobPayload {
  ingestionJobId: string;
  documentId: string;
  documentVersionId: string;
}

/**
 * Default BullMQ job options for reliable ingestion.
 *
 * - `attempts`: retry transient failures (embedding timeout, Redis/DB blip)
 * - `backoff`: exponential delay starting at 2s
 * - `removeOnComplete`/`removeOnFail`: keep jobs briefly for observability,
 *   BullMQ still tracks job state; DB is source of truth.
 * - `jobId` set to ingestionJobId for idempotent enqueue — duplicate add with
 *   same jobId is ignored by BullMQ.
 */
export const DEFAULT_JOB_OPTIONS: QueueOptions['defaultJobOptions'] = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 5000 },
};

export function createIngestionQueue(redis: Redis): Queue<IngestionJobPayload> {
  return new Queue<IngestionJobPayload>(INGESTION_QUEUE_NAME, {
    connection: redis as unknown as QueueOptions['connection'],
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export async function enqueueIngestionJob(
  queue: Queue<IngestionJobPayload>,
  payload: IngestionJobPayload,
): Promise<void> {
  // Idempotent: same jobId never creates duplicate BullMQ job.
  await queue.add(INGESTION_QUEUE_NAME, payload, {
    jobId: payload.ingestionJobId,
  });
}

import type { Job } from 'bullmq';
import { INGESTION_QUEUE_NAME } from '../jobs/queues';

/**
 * Ingestion processor placeholder.
 *
 * Milestone 7 introduces real processing (parse -> normalize -> chunk -> hash
 * -> compare -> embed -> index). Fail loudly rather than silently succeeding,
 * because BullMQ treats job completion as a durable state transition.
 */
export async function processIngestionJob(job: Job): Promise<void> {
  throw new Error(
    `Ingestion processing is not implemented yet (${INGESTION_QUEUE_NAME} job ${job.id ?? '<unknown>'}); arrives in Milestone 7.`,
  );
}

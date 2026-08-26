/**
 * Single ingestion/indexing queue.
 *
 * Per architecture rules, no per-stage queues (parse/chunk/embed/...) unless
 * operational requirements justify them later.
 */
export const INGESTION_QUEUE_NAME = 'ingestion';

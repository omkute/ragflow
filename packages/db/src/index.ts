export { createDb, type Database, type DbHandle, type PgSql } from './client';
export { assertPgVector, isPgVectorInstalled } from './pgvector';
export {
  chunks,
  documentStatusEnum,
  documents,
  documentVersions,
  ingestionJobStatusEnum,
  ingestionJobs,
} from './schema';

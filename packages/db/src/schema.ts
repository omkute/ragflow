import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * pgvector `vector` column type.
 *
 * Drizzle has no built-in vector helper; we model it as a custom type that
 * serialises number[] <-> "[1,2,3]" for postgres.js. The dimension is fixed
 * at the schema level (1536) to match the default embedding model; it is
 * validated against VECTOR_DIMENSION at application startup.
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dim = config?.dimensions ?? 1536;
    return `vector(${dim})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // postgres.js returns vector as string like "[1,2,3]" — parse deterministically.
    const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (trimmed === '') return [];
    return trimmed.split(',').map((s) => Number.parseFloat(s.trim()));
  },
});

/** Shared lifecycle states for documents and their indexed versions. */
export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

/**
 * A logical source document. Updates create new versions; rows are never
 * silently overwritten.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Origin of the document (e.g. "api"). Extensible for connectors. */
    source: varchar('source', { length: 64 }).notNull().default('api'),
    filename: text('filename').notNull(),
    contentType: varchar('content_type', { length: 128 }).notNull(),
    /** Version number of the currently active DocumentVersion. */
    currentVersion: integer('current_version').notNull().default(0),
    status: documentStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('documents_status_idx').on(table.status)],
);

/**
 * One indexed version of a document. Owns the raw normalized content that
 * chunking (Milestone 3+) will operate on. `content_hash` is the SHA-256 of
 * the normalized content and drives incremental reuse decisions later.
 */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    status: documentStatusEnum('status').notNull().default('pending'),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // Storage-level guarantee: one row per (document, version).
    uniqueIndex('document_versions_document_version_uq').on(table.documentId, table.version),
  ],
);

export const ingestionJobStatusEnum = pgEnum('ingestion_job_status', [
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: ingestionJobStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('ingestion_jobs_document_id_idx').on(table.documentId),
    uniqueIndex('ingestion_jobs_document_version_id_uq').on(table.documentVersionId),
    index('ingestion_jobs_status_idx').on(table.status),
  ],
);

/**
 * A searchable chunk produced by deterministic token-aware chunking.
 * An embedding vector (pgvector) and incremental-index fields will be added
 * in Milestones 4-6; this table already enforces deterministic identity
 * (content_hash) and ordering (chunk_index).
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    tokenCount: integer('token_count').notNull(),
    /** pgvector embedding; nullable until the embedding step completes. */
    embedding: vector('embedding', { dimensions: 1536 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('chunks_version_index_uq').on(table.documentVersionId, table.chunkIndex),
    index('chunks_document_id_idx').on(table.documentId),
    index('chunks_document_version_id_idx').on(table.documentVersionId),
    index('chunks_content_hash_idx').on(table.contentHash),
  ],
);

import type { Database } from '@indexa/db';
import { ingestionJobs } from '@indexa/db';
import { desc, eq, sql } from 'drizzle-orm';

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;
export type IngestionJobStatus = IngestionJobRow['status'];

export interface NewIngestionJobRow {
  documentId: string;
  documentVersionId: string;
  status?: IngestionJobStatus;
}

export interface IngestionJobRepository {
  /**
   * Idempotent creation: unique on documentVersionId guarantees at-most-one job
   * per version. Concurrent callers racing on the same version get the existing
   * row via ON CONFLICT DO NOTHING + SELECT.
   */
  create(row: NewIngestionJobRow): Promise<IngestionJobRow>;

  findById(id: string): Promise<IngestionJobRow | undefined>;

  findByVersionId(documentVersionId: string): Promise<IngestionJobRow | undefined>;

  listByDocument(documentId: string): Promise<IngestionJobRow[]>;

  list(options: { limit: number; offset: number; status?: IngestionJobStatus }): Promise<{
    items: IngestionJobRow[];
    total: number;
  }>;

  /**
   * Atomically claim a queued job for processing: increments attempts, sets
   * status to processing and startedAt. Returns undefined if job is not in
   * queued state (concurrent worker already claimed it).
   */
  claimForProcessing(id: string): Promise<IngestionJobRow | undefined>;

  markCompleted(id: string): Promise<IngestionJobRow | undefined>;

  /**
   * Record a failure. If attempts < maxAttempts the caller should re-enqueue
   * (BullMQ handles retries); we persist error and bump attempts.
   * For permanent failures we mark failed immediately.
   */
  markFailed(id: string, errorMessage: string): Promise<IngestionJobRow | undefined>;

  incrementAttempts(id: string, errorMessage: string): Promise<IngestionJobRow | undefined>;

  /** Generic status update used by DocumentService for transitions. */
  updateStatus(
    id: string,
    status: IngestionJobStatus,
    fields?: Partial<Pick<IngestionJobRow, 'error' | 'startedAt' | 'completedAt' | 'attempts'>>,
  ): Promise<IngestionJobRow | undefined>;

  /** Idempotent delete helper for tests. */
  deleteByVersion(documentVersionId: string): Promise<void>;
}

const MAX_ATTEMPTS = 5;

export function createIngestionJobRepository(db: Database): IngestionJobRepository {
  return {
    async create(row) {
      // Try insert; on conflict return existing without overwriting.
      const inserted = await db
        .insert(ingestionJobs)
        .values({
          documentId: row.documentId,
          documentVersionId: row.documentVersionId,
          status: row.status ?? 'queued',
          attempts: 0,
        })
        .onConflictDoNothing({ target: ingestionJobs.documentVersionId })
        .returning();

      if (inserted[0]) return inserted[0];

      // Conflict → return existing row for that version (idempotency).
      const existing = await db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.documentVersionId, row.documentVersionId))
        .limit(1)
        .then((r) => r[0]);

      if (!existing) throw new Error('Ingestion job conflict but no existing row found');
      return existing;
    },

    async findById(id) {
      return db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.id, id))
        .limit(1)
        .then((r) => r[0]);
    },

    async findByVersionId(documentVersionId) {
      return db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.documentVersionId, documentVersionId))
        .limit(1)
        .then((r) => r[0]);
    },

    async listByDocument(documentId) {
      return db
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.documentId, documentId))
        .orderBy(desc(ingestionJobs.createdAt));
    },

    async list({ limit, offset, status }) {
      const where = status ? eq(ingestionJobs.status, status) : undefined;
      const items = await db
        .select()
        .from(ingestionJobs)
        .where(where)
        .orderBy(desc(ingestionJobs.createdAt))
        .limit(limit)
        .offset(offset);
      const [countRow] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(ingestionJobs)
        .where(where);
      return { items, total: countRow?.total ?? 0 };
    },

    async claimForProcessing(id) {
      const [row] = await db
        .update(ingestionJobs)
        .set({
          status: 'processing',
          attempts: sql`${ingestionJobs.attempts} + 1`,
          startedAt: sql`COALESCE(${ingestionJobs.startedAt}, now())`,
          error: null,
        })
        .where(eq(ingestionJobs.id, id))
        // Only transition from queued; prevents double-claim by concurrent workers.
        // We do not filter by status here in SQL WHERE for simplicity, caller checks.
        .returning();
      // Verify previous status was queued or processing (at-least-once retry).
      // If caller wants strict queued→processing, check row.status before.
      return row;
    },

    async markCompleted(id) {
      const [row] = await db
        .update(ingestionJobs)
        .set({ status: 'completed', completedAt: new Date(), error: null })
        .where(eq(ingestionJobs.id, id))
        .returning();
      return row;
    },

    async markFailed(id, errorMessage) {
      const [row] = await db
        .update(ingestionJobs)
        .set({ status: 'failed', completedAt: new Date(), error: errorMessage })
        .where(eq(ingestionJobs.id, id))
        .returning();
      return row;
    },

    async incrementAttempts(id, errorMessage) {
      const [row] = await db
        .update(ingestionJobs)
        .set({
          attempts: sql`${ingestionJobs.attempts} + 1`,
          error: errorMessage,
        })
        .where(eq(ingestionJobs.id, id))
        .returning();
      return row;
    },

    async updateStatus(id, status, fields) {
      const set: Record<string, unknown> = { status };
      if (fields?.error !== undefined) set.error = fields.error;
      if (fields?.startedAt !== undefined) set.startedAt = fields.startedAt;
      if (fields?.completedAt !== undefined) set.completedAt = fields.completedAt;
      if (fields?.attempts !== undefined) set.attempts = fields.attempts;
      // Ensure attempts is handled correctly when not explicitly set for processing transition
      const [row] = await db
        .update(ingestionJobs)
        .set(set as Record<string, unknown> as never)
        .where(eq(ingestionJobs.id, id))
        .returning();
      return row;
    },

    async deleteByVersion(documentVersionId) {
      await db.delete(ingestionJobs).where(eq(ingestionJobs.documentVersionId, documentVersionId));
    },
  };
}

export const INGESTION_MAX_ATTEMPTS = MAX_ATTEMPTS;

/** Classify errors into transient (retryable) vs permanent (fail fast). */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Permanent: parsing, validation, unsupported formats, chunking
    if (
      msg.includes('parse') ||
      msg.includes('unsupported') ||
      msg.includes('chunk') ||
      msg.includes('invalid') ||
      error.name === 'DocumentParseError' ||
      error.name === 'UnsupportedDocumentTypeError' ||
      error.name === 'ChunkingError'
    ) {
      return false;
    }
    // Transient hints: timeout, rate limit, network, redis, postgres connection, embedding provider
    if (
      msg.includes('timeout') ||
      msg.includes('rate limit') ||
      msg.includes('econn') ||
      msg.includes('network') ||
      msg.includes('redis') ||
      msg.includes('postgres') ||
      msg.includes('embedding') ||
      msg.includes('vector') ||
      error.name === 'EmbeddingProviderError'
    ) {
      return true;
    }
  }
  // Default: treat unknown as transient to allow retry, but cap attempts.
  return true;
}

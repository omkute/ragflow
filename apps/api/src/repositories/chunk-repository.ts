import type { Database } from '@indexa/db';
import { chunks } from '@indexa/db';
import { asc, eq, sql } from 'drizzle-orm';

export type ChunkRow = typeof chunks.$inferSelect;

export interface NewChunkRow {
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface ChunkRepository {
  /** Idempotent bulk upsert: (documentVersionId, chunkIndex) is unique. */
  createMany(rows: NewChunkRow[]): Promise<ChunkRow[]>;

  findByDocumentVersion(documentVersionId: string): Promise<ChunkRow[]>;

  findByDocumentId(documentId: string): Promise<ChunkRow[]>;

  /** Remove all chunks for a version (used if re-processing needs cleanup). */
  deleteByVersion(documentVersionId: string): Promise<void>;
}

export function createChunkRepository(db: Database): ChunkRepository {
  return {
    async createMany(rows) {
      if (rows.length === 0) return [];

      // Idempotent upsert: at-least-once worker retries and concurrent
      // workers racing on the same (version, index) must not duplicate
      // active chunks. The unique constraint + ON CONFLICT DO UPDATE with
      // EXCLUDED values makes the second insert an atomic overwrite.
      return db
        .insert(chunks)
        .values(
          rows.map((r) => ({
            documentId: r.documentId,
            documentVersionId: r.documentVersionId,
            chunkIndex: r.chunkIndex,
            content: r.content,
            contentHash: r.contentHash,
            tokenCount: r.tokenCount,
            metadata: r.metadata,
          })),
        )
        .onConflictDoUpdate({
          target: [chunks.documentVersionId, chunks.chunkIndex],
          set: {
            content: sql`excluded.content`,
            contentHash: sql`excluded.content_hash`,
            tokenCount: sql`excluded.token_count`,
            metadata: sql`excluded.metadata`,
            updatedAt: sql`now()`,
          },
        })
        .returning();
    },

    async findByDocumentVersion(documentVersionId) {
      return db
        .select()
        .from(chunks)
        .where(eq(chunks.documentVersionId, documentVersionId))
        .orderBy(asc(chunks.chunkIndex));
    },

    async findByDocumentId(documentId) {
      return db
        .select()
        .from(chunks)
        .where(eq(chunks.documentId, documentId))
        .orderBy(asc(chunks.chunkIndex));
    },

    async deleteByVersion(documentVersionId) {
      await db.delete(chunks).where(eq(chunks.documentVersionId, documentVersionId));
    },
  };
}

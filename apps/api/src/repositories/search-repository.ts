import type { Database } from '@indexa/db';
import { sql } from 'drizzle-orm';

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchRepository {
  search(input: { queryEmbedding: number[]; topK: number; documentId?: string }): Promise<
    SearchHit[]
  >;
}

export function createSearchRepository(db: Database): SearchRepository {
  return {
    async search({ queryEmbedding, topK, documentId }) {
      const embeddingStr = `[${queryEmbedding.join(',')}]`;
      const docFilter = documentId ? sql`AND "document_id" = ${documentId}` : sql``;
      const result = await db.execute(sql`
        SELECT
          id as "chunkId",
          document_id as "documentId",
          document_version_id as "documentVersionId",
          chunk_index as "chunkIndex",
          content,
          metadata,
          1 - (embedding <=> ${embeddingStr}::vector) as "score"
        FROM "chunks"
        WHERE embedding IS NOT NULL
        ${docFilter}
        ORDER BY embedding <=> ${embeddingStr}::vector ASC
        LIMIT ${topK}
      `);
      const rows =
        (result as unknown as { rows?: unknown[] })?.rows ?? (result as unknown as unknown[]);
      const array = Array.isArray(rows) ? rows : (result as unknown as unknown[]);
      // biome-ignore lint/suspicious/noExplicitAny: pgvector raw rows require any for dynamic mapping
      return (array as any[]).map((r: any) => ({
        chunkId: r.chunkId ?? r.chunk_id ?? r.id,
        documentId: r.documentId ?? r.document_id,
        documentVersionId: r.documentVersionId ?? r.document_version_id,
        chunkIndex: Number(r.chunkIndex ?? r.chunk_index ?? 0),
        content: r.content,
        score: Number(r.score ?? 0),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      }));
    },
  };
}

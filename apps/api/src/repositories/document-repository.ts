import type { Database } from '@indexa/db';
import { documentVersions, documents } from '@indexa/db';
import { and, desc, eq, sql } from 'drizzle-orm';

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type DocumentStatus = DocumentRow['status'];
export type DocumentVersionStatus = DocumentVersionRow['status'];

export interface NewDocumentRow {
  source: string;
  filename: string;
  contentType: string;
  currentVersion: number;
  status: DocumentRow['status'];
}

export interface NewDocumentVersionRow {
  version: number;
  contentHash: string;
  status: DocumentVersionRow['status'];
  content: string;
  metadata: Record<string, unknown>;
  completedAt?: Date;
}

export interface DocumentRepository {
  /**
   * Atomically creates a document plus its initial version.
   * A single transaction guarantees no document exists without its version
   * row, and the unique (document_id, version) constraint makes retries safe.
   */
  createWithInitialVersion(
    doc: NewDocumentRow,
    version: NewDocumentVersionRow,
  ): Promise<{ document: DocumentRow; version: DocumentVersionRow }>;

  findById(id: string): Promise<DocumentRow | undefined>;

  findVersion(documentId: string, versionNumber: number): Promise<DocumentVersionRow | undefined>;

  list(limit: number, offset: number): Promise<{ items: DocumentRow[]; total: number }>;

  /** Hard delete; versions cascade. Returns true when a row was removed. */
  deleteById(id: string): Promise<boolean>;
}

export function createDocumentRepository(db: Database): DocumentRepository {
  return {
    async createWithInitialVersion(doc, version) {
      return db.transaction(async (tx) => {
        const [document] = await tx
          .insert(documents)
          .values({ ...doc, updatedAt: new Date() })
          .returning();

        if (!document) {
          throw new Error('Inserting document produced no row');
        }

        const [versionRow] = await tx
          .insert(documentVersions)
          .values({
            documentId: document.id,
            version: version.version,
            contentHash: version.contentHash,
            status: version.status,
            content: version.content,
            metadata: version.metadata,
            completedAt: version.completedAt ?? null,
          })
          .returning();

        if (!versionRow) {
          throw new Error('Inserting document version produced no row');
        }

        return { document, version: versionRow };
      });
    },

    findById(id) {
      return db
        .select()
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)
        .then((rows) => rows[0]);
    },

    findVersion(documentId, versionNumber) {
      return db
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.version, versionNumber),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
    },

    async list(limit, offset) {
      const items = await db
        .select()
        .from(documents)
        .orderBy(desc(documents.createdAt))
        .limit(limit)
        .offset(offset);

      const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(documents);

      return { items, total: countRow?.total ?? 0 };
    },

    async deleteById(id) {
      const deleted = await db.delete(documents).where(eq(documents.id, id)).returning({
        id: documents.id,
      });
      return deleted.length > 0;
    },
  };
}

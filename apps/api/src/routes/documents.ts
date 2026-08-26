import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseWith } from '../errors';
import type { ChunkRow } from '../repositories/chunk-repository';
import type { DocumentRow, DocumentVersionRow } from '../repositories/document-repository';
import {
  createDocumentSchema,
  listDocumentsQuerySchema,
  reindexDocumentSchema,
} from '../schemas/document-schemas';
import type { DocumentService } from '../services/document-service';

export interface DocumentsRoutesOptions {
  documentService: DocumentService;
}

const uuidParamSchema = z.object({ id: z.string().uuid() });

interface VersionView {
  id: string;
  version: number;
  contentHash: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  /** Only present on the detail view. */
  content?: string;
  metadata?: Record<string, unknown>;
}

interface ChunkView {
  id: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DocumentView {
  id: string;
  source: string;
  filename: string;
  contentType: string;
  currentVersion: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: VersionView | null;
}

function serializeVersion(
  version: DocumentVersionRow,
  options: { includeContent: boolean },
): VersionView {
  return {
    id: version.id,
    version: version.version,
    contentHash: version.contentHash,
    status: version.status,
    createdAt: version.createdAt.toISOString(),
    completedAt: version.completedAt ? version.completedAt.toISOString() : null,
    ...(options.includeContent ? { content: version.content, metadata: version.metadata } : {}),
  };
}

function serializeChunk(row: ChunkRow): ChunkView {
  return {
    id: row.id,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    contentHash: row.contentHash,
    tokenCount: row.tokenCount,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeDocument(
  document: DocumentRow,
  version: DocumentVersionRow | undefined,
  options: { includeContent: boolean },
): DocumentView {
  return {
    id: document.id,
    source: document.source,
    filename: document.filename,
    contentType: document.contentType,
    currentVersion: document.currentVersion,
    status: document.status,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    version: version ? serializeVersion(version, options) : null,
  };
}

/** Document ingestion endpoints. Thin handlers; logic lives in DocumentService. */
export async function documentsRoutes(
  app: FastifyInstance,
  options: DocumentsRoutesOptions,
): Promise<void> {
  const { documentService } = options;

  app.post('/documents', async (request, reply) => {
    const input = parseWith(createDocumentSchema, request.body);
    const result = await documentService.create(input);

    request.log.info(
      {
        document_id: result.document.id,
        document_version_id: result.version?.id,
        ingestion_job_id: result.ingestionJob.id,
      },
      'Document ingestion queued',
    );

    const isReady = result.ingestionJob.status === 'completed';
    const statusCode = isReady ? 201 : 202;
    const docView = serializeDocument(result.document, result.version, { includeContent: false });

    return reply.code(statusCode).send({
      ...docView,
      jobId: result.ingestionJob.id,
      job: {
        id: result.ingestionJob.id,
        status: result.ingestionJob.status,
        attempts: result.ingestionJob.attempts,
      },
    });
  });

  app.get('/documents', async (request, reply) => {
    const query = parseWith(listDocumentsQuerySchema, request.query);
    const { items, total } = await documentService.list(query.limit, query.offset);

    return reply.send({
      items: items.map((document) =>
        serializeDocument(document, undefined, { includeContent: false }),
      ),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.get('/documents/:id', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    const result = await documentService.get(id);

    return reply.send(serializeDocument(result.document, result.version, { includeContent: true }));
  });

  app.get('/documents/:id/chunks', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    const chunks = await documentService.listChunks(id);
    return reply.send({ documentId: id, chunks: chunks.map(serializeChunk) });
  });

  app.post('/documents/:id/reindex', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    const input = parseWith(reindexDocumentSchema, request.body);
    const result = await documentService.reindex(id, input);

    request.log.info(
      {
        document_id: result.document.id,
        document_version_id: result.version?.id,
        ingestion_job_id: result.ingestionJob.id,
      },
      'Document reindex queued',
    );

    const isReady = result.ingestionJob.status === 'completed';
    const statusCode = isReady ? 201 : 202;
    const docView = serializeDocument(result.document, result.version, { includeContent: false });

    return reply.code(statusCode).send({
      ...docView,
      jobId: result.ingestionJob.id,
      job: {
        id: result.ingestionJob.id,
        status: result.ingestionJob.status,
        attempts: result.ingestionJob.attempts,
      },
    });
  });

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    await documentService.delete(id);

    return reply.code(204).send();
  });
}

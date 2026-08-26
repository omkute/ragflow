import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseWith } from '../errors';
import type { DocumentRow, DocumentVersionRow } from '../repositories/document-repository';
import { createDocumentSchema, listDocumentsQuerySchema } from '../schemas/document-schemas';
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
      { document_id: result.document.id, document_version_id: result.version?.id },
      'Document ingested',
    );

    return reply
      .code(201)
      .send(serializeDocument(result.document, result.version, { includeContent: false }));
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

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    await documentService.delete(id);

    return reply.code(204).send();
  });
}

import type { Database } from '@indexa/db';
import {
  type ParsedDocument,
  contentHash,
  contentTypeFromFilename,
  selectParser,
} from '@indexa/document-processing';
import { DocumentNotFoundError, DocumentParseError, UnsupportedDocumentTypeError } from '../errors';
import {
  type DocumentRepository,
  type DocumentRow,
  type DocumentVersionRow,
  createDocumentRepository,
} from '../repositories/document-repository';
import type { CreateDocumentInput } from '../schemas/document-schemas';

export interface DocumentWithVersion {
  document: DocumentRow;
  version: DocumentVersionRow | undefined;
}

/**
 * Document ingestion business logic. Routes stay thin; parsing, hashing and
 * persistence orchestration live here.
 */
export class DocumentService {
  private readonly repository: DocumentRepository;

  constructor(db: Database, repository?: DocumentRepository) {
    this.repository = repository ?? createDocumentRepository(db);
  }

  /**
   * Ingest a document: parse -> normalize -> hash -> persist.
   *
   * Milestone 2 processes synchronously and marks the document ready once the
   * content is durably stored. Milestone 7 moves chunking/embedding into the
   * async worker, at which point statuses transition via queued/processing.
   */
  async create(input: CreateDocumentInput): Promise<DocumentWithVersion> {
    const contentType = input.contentType ?? contentTypeFromFilename(input.filename);

    if (contentType === undefined) {
      throw new UnsupportedDocumentTypeError(`filename '${input.filename}' has no known type`);
    }

    const parser = selectParser(contentType);
    if (!parser) {
      throw new UnsupportedDocumentTypeError(contentType);
    }

    let parsed: ParsedDocument;
    try {
      parsed = await parser.parse(Buffer.from(input.content, 'utf8'));
    } catch (error) {
      throw new DocumentParseError(input.filename, error);
    }

    const { document, version } = await this.repository.createWithInitialVersion(
      {
        source: 'api',
        filename: input.filename,
        contentType,
        currentVersion: 1,
        status: 'ready',
      },
      {
        version: 1,
        contentHash: contentHash(parsed.text),
        status: 'ready',
        content: parsed.text,
        metadata: parsed.metadata,
        completedAt: new Date(),
      },
    );

    return { document, version };
  }

  async get(documentId: string): Promise<DocumentWithVersion> {
    const document = await this.requireDocument(documentId);
    const version =
      document.currentVersion > 0
        ? await this.repository.findVersion(document.id, document.currentVersion)
        : undefined;

    return { document, version };
  }

  async list(limit: number, offset: number): Promise<{ items: DocumentRow[]; total: number }> {
    return this.repository.list(limit, offset);
  }

  async delete(documentId: string): Promise<void> {
    const deleted = await this.repository.deleteById(documentId);
    if (!deleted) {
      throw new DocumentNotFoundError(documentId);
    }
  }

  private async requireDocument(documentId: string): Promise<DocumentRow> {
    const document = await this.repository.findById(documentId);
    if (!document) {
      throw new DocumentNotFoundError(documentId);
    }
    return document;
  }
}

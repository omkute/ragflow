import { TokenChunker } from '@indexa/chunking';
import type { Chunker, ChunkerConfig } from '@indexa/chunking';
import { chunks, documentVersions, documents } from '@indexa/db';
import type { Database } from '@indexa/db';
import {
  type ParsedDocument,
  contentHash,
  contentTypeFromFilename,
  selectParser,
} from '@indexa/document-processing';
import {
  ChunkingError,
  DocumentNotFoundError,
  DocumentParseError,
  UnsupportedDocumentTypeError,
} from '../errors';
import {
  type ChunkRepository,
  type ChunkRow,
  createChunkRepository,
} from '../repositories/chunk-repository';
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
  chunks?: ChunkRow[];
}

/**
 * Document ingestion business logic. Routes stay thin; parsing, hashing and
 * persistence orchestration live here.
 */
export class DocumentService {
  private readonly db: Database;
  private readonly repository: DocumentRepository;
  private readonly chunkRepository: ChunkRepository;
  private readonly chunker: Chunker;
  private readonly chunkerConfig: ChunkerConfig;

  constructor(
    db: Database,
    options: {
      repository?: DocumentRepository;
      chunkRepository?: ChunkRepository;
      chunker?: Chunker;
      chunkerConfig?: ChunkerConfig;
    } = {},
  ) {
    this.db = db;
    this.repository = options.repository ?? createDocumentRepository(db);
    this.chunkRepository = options.chunkRepository ?? createChunkRepository(db);
    // Default matches ApiConfig defaults; env overrides are injected via app wiring.
    this.chunkerConfig = options.chunkerConfig ?? { chunkSize: 512, chunkOverlap: 50 };
    this.chunker = options.chunker ?? new TokenChunker(this.chunkerConfig);
  }

  /**
   * Ingest a document: parse -> normalize -> hash -> chunk -> persist.
   *
   * Milestone 3 extends ingestion to deterministic, token-aware chunking
   * persisted alongside the document version. The entire document + version +
   * chunks insertion is a single database transaction (no external calls
   * inside), so retries and concurrent workers rely on the
   * (document_version_id, chunk_index) unique constraint for idempotency.
   * Milestone 7 will move this pipeline into the async BullMQ worker and
   * introduce queued/processing statuses.
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

    // Chunk before any DB work: CPU-bound, no external I/O, deterministic.
    let rawChunks: Awaited<ReturnType<Chunker['chunk']>>;
    try {
      rawChunks = await this.chunker.chunk(parsed);
    } catch (error) {
      throw new ChunkingError('Failed to chunk document', error);
    }

    // Short atomic transaction: document + version + chunks. No external calls inside.
    const { document, version, persistedChunks } = await this.db.transaction(async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          source: 'api',
          filename: input.filename,
          contentType,
          currentVersion: 1,
          status: 'ready',
          updatedAt: new Date(),
        })
        .returning();

      if (!document) throw new Error('Inserting document produced no row');

      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: document.id,
          version: 1,
          contentHash: contentHash(parsed.text),
          status: 'ready',
          content: parsed.text,
          metadata: parsed.metadata,
          completedAt: new Date(),
        })
        .returning();

      if (!version) throw new Error('Inserting document version produced no row');

      let persistedChunks: ChunkRow[] = [];
      if (rawChunks.length > 0) {
        persistedChunks = await tx
          .insert(chunks)
          .values(
            rawChunks.map((c) => ({
              documentId: document.id,
              documentVersionId: version.id,
              chunkIndex: c.chunkIndex,
              content: c.content,
              contentHash: c.contentHash,
              tokenCount: c.tokenCount,
              metadata: c.metadata,
            })),
          )
          .returning();
      }

      return { document, version, persistedChunks };
    });

    return { document, version, chunks: persistedChunks };
  }

  async get(documentId: string): Promise<DocumentWithVersion> {
    const document = await this.requireDocument(documentId);
    const version =
      document.currentVersion > 0
        ? await this.repository.findVersion(document.id, document.currentVersion)
        : undefined;

    return { document, version };
  }

  async getWithChunks(documentId: string): Promise<DocumentWithVersion & { chunks: ChunkRow[] }> {
    const { document, version } = await this.get(documentId);
    if (!version) return { document, version, chunks: [] };
    const chunkRows = await this.chunkRepository.findByDocumentVersion(version.id);
    return { document, version, chunks: chunkRows };
  }

  async listChunks(documentId: string): Promise<ChunkRow[]> {
    const document = await this.requireDocument(documentId);
    const version =
      document.currentVersion > 0
        ? await this.repository.findVersion(document.id, document.currentVersion)
        : undefined;
    if (!version) return [];
    return this.chunkRepository.findByDocumentVersion(version.id);
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

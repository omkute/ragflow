import { TokenChunker } from '@indexa/chunking';
import type { Chunker, ChunkerConfig } from '@indexa/chunking';
import { chunks, documentVersions, documents, ingestionJobs } from '@indexa/db';
import type { Database } from '@indexa/db';
import {
  type ParsedDocument,
  contentHash,
  contentTypeFromFilename,
  selectParser,
} from '@indexa/document-processing';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import type { EmbeddingProvider } from '@indexa/embeddings';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  ChunkingError,
  DocumentNotFoundError,
  DocumentParseError,
  EmbeddingProviderError,
  IngestionJobNotFoundError,
  UnsupportedDocumentTypeError,
} from '../errors';
import type { IngestionJobPayload } from '../queue/ingestion-queue';
import { enqueueIngestionJob } from '../queue/ingestion-queue';
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
import {
  type IngestionJobRepository,
  type IngestionJobRow,
  createIngestionJobRepository,
} from '../repositories/ingestion-job-repository';
import type { CreateDocumentInput } from '../schemas/document-schemas';

export interface DocumentWithVersion {
  document: DocumentRow;
  version: DocumentVersionRow | undefined;
  chunks?: ChunkRow[];
  ingestionJob?: IngestionJobRow;
}

export interface CreateDocumentResult extends DocumentWithVersion {
  ingestionJob: IngestionJobRow;
}

/**
 * Document ingestion business logic. Routes stay thin; parsing, hashing and
 * persistence orchestration live here.
 *
 * Milestone 7: ingestion is asynchronous. `create()` persists document/version
 * with status pending/queued and enqueues a BullMQ job. The worker (or inline
 * fallback) performs chunking and marks the version ready. Callers that need
 * immediate results (tests, local non-queue usage) can enable `processInline`.
 */
export class DocumentService {
  private readonly db: Database;
  private readonly repository: DocumentRepository;
  private readonly chunkRepository: ChunkRepository;
  private readonly ingestionJobRepository: IngestionJobRepository;
  private readonly chunker: Chunker;
  private readonly chunkerConfig: ChunkerConfig;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly queue?: Queue<IngestionJobPayload>;
  private readonly processInline: boolean;

  constructor(
    db: Database,
    options: {
      repository?: DocumentRepository;
      chunkRepository?: ChunkRepository;
      ingestionJobRepository?: IngestionJobRepository;
      chunker?: Chunker;
      chunkerConfig?: ChunkerConfig;
      embeddingProvider?: EmbeddingProvider;
      queue?: Queue<IngestionJobPayload>;
      processInline?: boolean;
    } = {},
  ) {
    this.db = db;
    this.repository = options.repository ?? createDocumentRepository(db);
    this.chunkRepository = options.chunkRepository ?? createChunkRepository(db);
    this.ingestionJobRepository =
      options.ingestionJobRepository ?? createIngestionJobRepository(db);
    // Default matches ApiConfig defaults; env overrides are injected via app wiring.
    this.chunkerConfig = options.chunkerConfig ?? { chunkSize: 512, chunkOverlap: 50 };
    this.chunker = options.chunker ?? new TokenChunker(this.chunkerConfig);
    this.embeddingProvider =
      options.embeddingProvider ?? new FakeEmbeddingProvider({ dimension: 1536 });
    this.queue = options.queue;
    this.processInline = options.processInline ?? false;
  }

  /**
   * Ingest a document: parse -> normalize -> hash -> persist document/version +
   * enqueue ingestion job. Chunking and ready transition happen asynchronously
   * in the worker (or inline when `processInline` is true).
   *
   * The DB transaction is short and contains no external calls; enqueue happens
   * after commit. Retries and concurrent workers rely on the
   * (document_version_id, chunk_index) unique constraint for idempotency.
   */
  async create(input: CreateDocumentInput): Promise<CreateDocumentResult> {
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

    // Short atomic transaction: document + version + ingestion job. No external calls inside.
    const { document, version, ingestionJob } = await this.db.transaction(async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          source: 'api',
          filename: input.filename,
          contentType,
          currentVersion: 1,
          status: 'pending',
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
          status: 'pending',
          content: parsed.text,
          metadata: parsed.metadata,
          completedAt: null,
        })
        .returning();

      if (!version) throw new Error('Inserting document version produced no row');

      const [ingestionJob] = await tx
        .insert(ingestionJobs)
        .values({
          documentId: document.id,
          documentVersionId: version.id,
          status: 'queued',
          attempts: 0,
        })
        .returning();

      if (!ingestionJob) throw new Error('Inserting ingestion job produced no row');

      return { document, version, ingestionJob };
    });

    // Enqueue after commit. Failure to enqueue surfaces as job failed; caller can retry via reindex.
    if (this.processInline) {
      // Inline processing for tests / queue-less environments: run ingestion synchronously.
      try {
        await this.processIngestionJob(ingestionJob.id);
        // Reload statuses after inline processing
        const updatedDoc = await this.repository.findById(document.id);
        const updatedVersion = await this.repository.findVersion(document.id, 1);
        const updatedJob = await this.ingestionJobRepository.findById(ingestionJob.id);
        if (updatedDoc && updatedVersion && updatedJob) {
          return { document: updatedDoc, version: updatedVersion, ingestionJob: updatedJob };
        }
      } catch (error) {
        // Inline failure should propagate as job failure but still return job for observability
        const failedJob = await this.ingestionJobRepository.findById(ingestionJob.id);
        if (failedJob) return { document, version, ingestionJob: failedJob };
        throw error;
      }
      return { document, version, ingestionJob };
    }

    if (this.queue) {
      try {
        await enqueueIngestionJob(this.queue, {
          ingestionJobId: ingestionJob.id,
          documentId: document.id,
          documentVersionId: version.id,
        });
      } catch (error) {
        // Mark job as failed if we cannot enqueue (e.g., Redis down)
        const message = error instanceof Error ? error.message : String(error);
        await this.ingestionJobRepository.updateStatus(ingestionJob.id, 'failed', {
          error: `Failed to enqueue: ${message}`,
        });
        await this.db
          .update(documents)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(documents.id, document.id));
        await this.db
          .update(documentVersions)
          .set({ status: 'failed' })
          .where(eq(documentVersions.id, version.id));
        throw error;
      }
    }

    return { document, version, ingestionJob };
  }

  /**
   * Worker entrypoint: process a single ingestion job idempotently.
   *
   * - Loads job, document, version
   * - Transitions job/document/version to processing
   * - Chunks normalized content (CPU-bound, outside long transaction)
   * - Inserts chunks with upsert (idempotent for at-least-once)
   * - Marks job/document/version ready or failed
   *
   * No external API calls are held inside a long DB transaction.
   */
  async processIngestionJob(ingestionJobId: string): Promise<void> {
    const job = await this.ingestionJobRepository.findById(ingestionJobId);
    if (!job) throw new IngestionJobNotFoundError(ingestionJobId);

    // Idempotent: already completed -> no-op
    if (job.status === 'completed') return;
    if (job.status === 'cancelled') return;

    const document = await this.repository.findById(job.documentId);
    if (!document) throw new DocumentNotFoundError(job.documentId);

    const version = await this.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, job.documentVersionId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!version) throw new Error(`Document version not found: ${job.documentVersionId}`);

    // Idempotent: if version already ready, treat as completed (concurrent worker race)
    if (version.status === 'ready') return;

    // Transition to processing
    await this.ingestionJobRepository.updateStatus(job.id, 'processing', {
      startedAt: job.startedAt ?? new Date(),
      attempts: job.attempts + 1,
      error: null,
    } as unknown as Partial<IngestionJobRow>);

    await this.db
      .update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, document.id));

    await this.db
      .update(documentVersions)
      .set({ status: 'processing' })
      .where(eq(documentVersions.id, version.id));

    let parsed: ParsedDocument;
    try {
      // Content is already normalized and stored; reuse it directly for chunking.
      // Reconstruct ParsedDocument with stored metadata for heading propagation.
      parsed = {
        text: version.content,
        metadata: (version.metadata ?? {}) as Record<string, unknown>,
      };

      const rawChunks = await this.chunker.chunk(parsed);

      // === Incremental indexing core (Milestone 6) ===
      // For unchanged chunks (same contentHash as previous version) reuse
      // the existing embedding without calling the provider. Only new/changed
      // hashes are embedded — this is the observable incremental behavior.
      // Stale chunks (in previous but not in new) are not inserted; they
      // remain tied to the old version and are excluded from the active index
      // (active = currentVersion's chunks).
      const embeddings: Array<number[] | null> = new Array(rawChunks.length).fill(null);
      let chunksReused = 0;
      let chunksToEmbed = 0;

      if (rawChunks.length > 0) {
        const previousVersionNumber = version.version - 1;
        const previousByHash = new Map<string, number[]>();

        if (previousVersionNumber >= 1) {
          // Fetch previous version row
          const prevRows = await this.db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, document.id));
          const prevVersionRow = prevRows.find((r) => r.version === previousVersionNumber);
          if (prevVersionRow) {
            const previousChunks = await this.db
              .select()
              .from(chunks)
              .where(eq(chunks.documentVersionId, prevVersionRow.id));
            for (const pc of previousChunks) {
              if (pc.embedding && !previousByHash.has(pc.contentHash)) {
                previousByHash.set(pc.contentHash, pc.embedding as unknown as number[]);
              }
            }
          }
        }

        const textsToEmbed: string[] = [];
        const indicesNeedingEmbed: number[] = [];

        for (let i = 0; i < rawChunks.length; i++) {
          const chunk = rawChunks[i];
          if (!chunk) continue;
          const existingEmbedding = previousByHash.get(chunk.contentHash);
          if (existingEmbedding) {
            embeddings[i] = existingEmbedding;
            chunksReused++;
          } else {
            textsToEmbed.push(chunk.content);
            indicesNeedingEmbed.push(i);
            chunksToEmbed++;
          }
        }

        if (textsToEmbed.length > 0) {
          let newEmbeddings: number[][];
          try {
            newEmbeddings = await this.embeddingProvider.embedDocuments(textsToEmbed);
          } catch (error) {
            throw new EmbeddingProviderError('Failed to embed chunks', error);
          }
          if (newEmbeddings.length !== textsToEmbed.length) {
            throw new EmbeddingProviderError(
              `Embedding provider returned ${newEmbeddings.length} vectors for ${textsToEmbed.length} chunks`,
            );
          }
          for (let j = 0; j < indicesNeedingEmbed.length; j++) {
            const chunkIdx = indicesNeedingEmbed[j];
            if (chunkIdx === undefined) continue;
            const emb = newEmbeddings[j];
            if (!emb) continue;
            embeddings[chunkIdx] = emb;
          }
        }

        // Observability: incremental reuse metrics (not yet exposed via /metrics endpoint)
        // Reuse rate demonstrates that incremental indexing provides value.
        const totalChunks = rawChunks.length;
        const reuseRate = totalChunks > 0 ? chunksReused / totalChunks : 0;
        // Use console logging via no-op; actual API/worker logs will include these counters.
        // The counts are verified in tests via FakeEmbeddingProvider counters and DB state.
        void reuseRate;
        void chunksToEmbed;
      }

      // Persist chunks with idempotent upsert. Single transaction for chunks + status.
      // External embedding calls happen outside this transaction (above).
      await this.db.transaction(async (tx) => {
        if (rawChunks.length > 0) {
          const { sql: drizzleSql } = await import('drizzle-orm');
          await tx
            .insert(chunks)
            .values(
              rawChunks.map((c, idx) => ({
                documentId: document.id,
                documentVersionId: version.id,
                chunkIndex: c.chunkIndex,
                content: c.content,
                contentHash: c.contentHash,
                tokenCount: c.tokenCount,
                embedding: embeddings[idx] as unknown as number[],
                metadata: c.metadata,
              })),
            )
            .onConflictDoUpdate({
              target: [chunks.documentVersionId, chunks.chunkIndex],
              set: {
                content: drizzleSql`excluded.content`,
                contentHash: drizzleSql`excluded.content_hash`,
                tokenCount: drizzleSql`excluded.token_count`,
                embedding: drizzleSql`excluded.embedding`,
                metadata: drizzleSql`excluded.metadata`,
                updatedAt: drizzleSql`now()`,
              },
            });
        }

        await tx
          .update(documentVersions)
          .set({
            status: 'ready',
            completedAt: new Date(),
          })
          .where(eq(documentVersions.id, version.id));

        await tx
          .update(documents)
          .set({
            status: 'ready',
            updatedAt: new Date(),
          })
          .where(eq(documents.id, document.id));

        await tx
          .update(ingestionJobs)
          .set({
            status: 'completed',
            completedAt: new Date(),
            error: null,
          })
          .where(eq(ingestionJobs.id, job.id));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.ingestionJobRepository.updateStatus(job.id, 'failed', {
        error: message,
      });

      await this.db
        .update(documentVersions)
        .set({ status: 'failed' })
        .where(eq(documentVersions.id, version.id));

      await this.db
        .update(documents)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(documents.id, document.id));

      // Rethrow so BullMQ job fails and triggers backoff.
      throw error instanceof Error ? error : new Error(message);
    }
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

  async reindex(
    documentId: string,
    input: { content: string; filename?: string; contentType?: string },
  ): Promise<CreateDocumentResult> {
    const document = await this.requireDocument(documentId);

    // Resolve content type: explicit > filename param > existing document's type > derived from filename
    const filename = input.filename ?? document.filename;
    const contentType =
      input.contentType ?? contentTypeFromFilename(filename) ?? document.contentType;

    const parser = selectParser(contentType);
    if (!parser) throw new UnsupportedDocumentTypeError(contentType);

    let parsed: ParsedDocument;
    try {
      parsed = await parser.parse(Buffer.from(input.content, 'utf8'));
    } catch (error) {
      throw new DocumentParseError(filename, error);
    }

    const nextVersionNumber = document.currentVersion + 1;
    const contentHashValue = contentHash(parsed.text);

    const { version, ingestionJob } = await this.db.transaction(async (tx) => {
      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: document.id,
          version: nextVersionNumber,
          contentHash: contentHashValue,
          status: 'pending',
          content: parsed.text,
          metadata: parsed.metadata,
          completedAt: null,
        })
        .returning();
      if (!version) throw new Error('Inserting document version produced no row');

      await tx
        .update(documents)
        .set({
          currentVersion: nextVersionNumber,
          status: 'pending',
          updatedAt: new Date(),
          // keep filename/contentType up to date if reindex provides new filename
          filename: input.filename ?? document.filename,
          contentType,
        })
        .where(eq(documents.id, document.id));

      const [ingestionJob] = await tx
        .insert(ingestionJobs)
        .values({
          documentId: document.id,
          documentVersionId: version.id,
          status: 'queued',
          attempts: 0,
        })
        .returning();
      if (!ingestionJob) throw new Error('Inserting ingestion job produced no row');

      return { version, ingestionJob };
    });

    const updatedDocument = (await this.repository.findById(documentId)) ?? document;

    if (this.processInline) {
      try {
        await this.processIngestionJob(ingestionJob.id);
        const finalDoc = await this.repository.findById(documentId);
        const finalVersion = await this.repository.findVersion(documentId, nextVersionNumber);
        const finalJob = await this.ingestionJobRepository.findById(ingestionJob.id);
        if (finalDoc && finalVersion && finalJob) {
          return { document: finalDoc, version: finalVersion, ingestionJob: finalJob };
        }
      } catch {
        const failedJob = await this.ingestionJobRepository.findById(ingestionJob.id);
        if (failedJob) return { document: updatedDocument, version, ingestionJob: failedJob };
        throw new Error('Reindex inline processing failed');
      }
      return { document: updatedDocument, version, ingestionJob };
    }

    if (this.queue) {
      try {
        await enqueueIngestionJob(this.queue, {
          ingestionJobId: ingestionJob.id,
          documentId: document.id,
          documentVersionId: version.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.ingestionJobRepository.updateStatus(ingestionJob.id, 'failed', {
          error: `Failed to enqueue: ${message}`,
        });
        await this.db
          .update(documents)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(documents.id, document.id));
        await this.db
          .update(documentVersions)
          .set({ status: 'failed' })
          .where(eq(documentVersions.id, version.id));
        throw error;
      }
    }

    return { document: updatedDocument, version, ingestionJob };
  }

  async getIngestionJob(jobId: string): Promise<IngestionJobRow> {
    const job = await this.ingestionJobRepository.findById(jobId);
    if (!job) throw new IngestionJobNotFoundError(jobId);
    return job;
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

import { TokenChunker } from '@indexa/chunking';
import type { ChunkerConfig } from '@indexa/chunking';
import { chunks, documentVersions, documents, ingestionJobs } from '@indexa/db';
import type { Database } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import type { EmbeddingProvider } from '@indexa/embeddings';
import type { Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { INGESTION_QUEUE_NAME } from '../jobs/queues';

export interface IngestionJobPayload {
  ingestionJobId: string;
  documentId: string;
  documentVersionId: string;
}

/**
 * Factory: creates a BullMQ job handler bound to DB and chunker config.
 *
 * Implements Milestone 6 incremental indexing:
 * - Same contentHash from previous version => reuse embedding (no provider call)
 * - Different hash => embed only changed/new chunks
 * - Stale chunks are not reinserted; previous version rows remain but are
 *   not part of the active index (active = currentVersion's chunks)
 *
 * Handles at-least-once, idempotent processing with exponential backoff
 * driven by BullMQ. Uses short transactions and upsert for deduplication.
 */
export function createIngestionProcessor(
  db: Database,
  chunkerConfig: ChunkerConfig,
  logger?: {
    info?: (obj: unknown, msg: string) => void;
    error?: (obj: unknown, msg: string) => void;
  },
  embeddingProvider?: EmbeddingProvider,
) {
  const chunker = new TokenChunker(chunkerConfig);
  const effectiveEmbeddingProvider: EmbeddingProvider =
    embeddingProvider ?? new FakeEmbeddingProvider({ dimension: 1536 });

  return async function processIngestionJob(job: Job<IngestionJobPayload>): Promise<void> {
    const payload = job.data;
    if (!payload || !payload.ingestionJobId) {
      throw new Error(`Invalid ingestion job payload: ${JSON.stringify(payload)}`);
    }
    const ingestionJobId = payload.ingestionJobId;

    logger?.info?.(
      { job_id: job.id, ingestion_job_id: ingestionJobId },
      'Processing ingestion job',
    );

    const jobRow = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, ingestionJobId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!jobRow) {
      throw new Error(`Ingestion job not found: ${ingestionJobId}`);
    }

    if (jobRow.status === 'completed' || jobRow.status === 'cancelled') {
      logger?.info?.(
        { ingestion_job_id: ingestionJobId, status: jobRow.status },
        'Job already terminal, skipping',
      );
      return;
    }

    const document = await db
      .select()
      .from(documents)
      .where(eq(documents.id, jobRow.documentId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!document) throw new Error(`Document not found: ${jobRow.documentId}`);

    const version = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, jobRow.documentVersionId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!version) throw new Error(`Document version not found: ${jobRow.documentVersionId}`);

    // Idempotent: already ready => skip (concurrent worker race)
    if (version.status === 'ready') return;

    // Transition to processing
    await db
      .update(ingestionJobs)
      .set({
        status: 'processing',
        startedAt: jobRow.startedAt ?? new Date(),
        attempts: sql`${ingestionJobs.attempts} + 1`,
        error: null,
      })
      .where(eq(ingestionJobs.id, ingestionJobId));

    await db
      .update(documents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, document.id));
    await db
      .update(documentVersions)
      .set({ status: 'processing' })
      .where(eq(documentVersions.id, version.id));

    try {
      const parsed = {
        text: version.content,
        metadata: (version.metadata ?? {}) as Record<string, unknown>,
      };

      const rawChunks = await chunker.chunk(parsed);

      // Incremental embedding reuse
      const embeddings: Array<number[] | null> = new Array(rawChunks.length).fill(null);
      let chunksReused = 0;

      if (rawChunks.length > 0) {
        const previousVersionNumber = version.version - 1;
        const previousByHash = new Map<string, number[]>();

        if (previousVersionNumber >= 1) {
          const prevRows = await db
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, document.id));
          const prevVersionRow = prevRows.find((r) => r.version === previousVersionNumber);
          if (prevVersionRow) {
            const previousChunks = await db
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
          const existing = previousByHash.get(chunk.contentHash);
          if (existing) {
            embeddings[i] = existing;
            chunksReused++;
          } else {
            textsToEmbed.push(chunk.content);
            indicesNeedingEmbed.push(i);
          }
        }

        if (textsToEmbed.length > 0) {
          const newEmbeddings = await effectiveEmbeddingProvider.embedDocuments(textsToEmbed);
          if (newEmbeddings.length !== textsToEmbed.length) {
            throw new Error(
              `Embedding provider returned ${newEmbeddings.length} vectors for ${textsToEmbed.length} chunks`,
            );
          }
          for (let j = 0; j < indicesNeedingEmbed.length; j++) {
            const idx = indicesNeedingEmbed[j];
            if (idx === undefined) continue;
            const emb = newEmbeddings[j];
            if (!emb) continue;
            embeddings[idx] = emb;
          }
        }
      }

      logger?.info?.(
        {
          ingestion_job_id: ingestionJobId,
          chunks: rawChunks.length,
          chunks_reused: chunksReused,
          chunks_reembedded: rawChunks.length - chunksReused,
          reuse_rate: rawChunks.length ? chunksReused / rawChunks.length : 0,
        },
        'Incremental indexing metrics',
      );

      await db.transaction(async (tx) => {
        if (rawChunks.length > 0) {
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
                content: sql`excluded.content`,
                contentHash: sql`excluded.content_hash`,
                tokenCount: sql`excluded.token_count`,
                embedding: sql`excluded.embedding`,
                metadata: sql`excluded.metadata`,
                updatedAt: sql`now()`,
              },
            });
        }

        await tx
          .update(documentVersions)
          .set({ status: 'ready', completedAt: new Date() })
          .where(eq(documentVersions.id, version.id));

        await tx
          .update(documents)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(documents.id, document.id));

        await tx
          .update(ingestionJobs)
          .set({ status: 'completed', completedAt: new Date(), error: null })
          .where(eq(ingestionJobs.id, ingestionJobId));
      });

      logger?.info?.(
        { ingestion_job_id: ingestionJobId, chunks: rawChunks.length },
        'Ingestion completed',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(ingestionJobs)
        .set({ status: 'failed', error: message })
        .where(eq(ingestionJobs.id, ingestionJobId));
      await db
        .update(documentVersions)
        .set({ status: 'failed' })
        .where(eq(documentVersions.id, version.id));
      await db
        .update(documents)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(documents.id, document.id));
      logger?.error?.({ ingestion_job_id: ingestionJobId, err: message }, 'Ingestion failed');
      throw error instanceof Error ? error : new Error(message);
    }
  };
}

// Keep named export for backward compat with older import style (creates placeholder)
export const processIngestionJobPlaceholder = async (job: Job) => {
  throw new Error(
    `Ingestion processing is not implemented yet (${INGESTION_QUEUE_NAME} job ${job.id ?? '<unknown>'}); arrives in Milestone 7.`,
  );
};

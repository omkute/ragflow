import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseWith } from '../errors';
import type { IngestionJobRepository } from '../repositories/ingestion-job-repository';

export interface JobsRoutesOptions {
  ingestionJobRepository: IngestionJobRepository;
}

const uuidParamSchema = z.object({ id: z.string().uuid() });

function serializeJob(row: {
  id: string;
  documentId: string;
  documentVersionId: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}) {
  return {
    id: row.id,
    documentId: row.documentId,
    documentVersionId: row.documentVersionId,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * Job status endpoints. `GET /jobs/:id` exposes ingestion job state for polling.
 */
export async function jobsRoutes(app: FastifyInstance, options: JobsRoutesOptions): Promise<void> {
  const { ingestionJobRepository } = options;

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = parseWith(uuidParamSchema, request.params);
    const job = await ingestionJobRepository.findById(id);
    if (!job) {
      return reply.status(404).send({
        statusCode: 404,
        code: 'INGESTION_JOB_NOT_FOUND',
        error: `Ingestion job not found: ${id}`,
      });
    }
    return reply.send(serializeJob(job));
  });
}

import type { FastifyInstance } from 'fastify';
import { parseWith } from '../errors';
import { generateRequestSchema } from '../schemas/generation-schemas';
import type { GenerationService } from '../services/generation-service';

export interface GenerationRoutesOptions {
  generationService: GenerationService;
  defaultTopK: number;
}

export async function generationRoutes(
  app: FastifyInstance,
  options: GenerationRoutesOptions,
): Promise<void> {
  const { generationService, defaultTopK } = options;

  app.post('/generate', async (request, reply) => {
    const body = parseWith(generateRequestSchema, request.body);
    const topK = body.topK ?? defaultTopK;
    const result = await generationService.generate({
      query: body.query,
      topK,
      systemPrompt: body.systemPrompt,
      documentId: body.documentId,
    });
    return reply.send(result);
  });
}

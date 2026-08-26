import type { FastifyInstance } from 'fastify';
import { parseWith } from '../errors';
import { searchRequestSchema } from '../schemas/search-schemas';
import type { SearchService } from '../services/search-service';

export interface SearchRoutesOptions {
  searchService: SearchService;
  defaultTopK: number;
}

export async function searchRoutes(
  app: FastifyInstance,
  options: SearchRoutesOptions,
): Promise<void> {
  const { searchService, defaultTopK } = options;

  app.post('/search', async (request, reply) => {
    const body = parseWith(searchRequestSchema, request.body);
    const topK = body.topK ?? defaultTopK;
    const result = await searchService.search({
      query: body.query,
      topK,
      documentId: body.documentId,
    });
    return reply.send(result);
  });
}

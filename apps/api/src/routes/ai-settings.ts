import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseWith } from '../errors';
import type { RuntimeEmbeddingProvider, RuntimeLLMProvider } from '../services/runtime-ai-settings';

const updateSchema = z.object({
  embeddingProvider: z.enum(['fake', 'openai', 'gemini', 'openai-compatible']).optional(),
  embeddingModel: z.string().min(1).max(200).optional(),
  embeddingApiKey: z.string().min(1).max(500).optional(),
  embeddingBaseUrl: z.string().url().max(500).optional(),
  llmProvider: z.enum(['fake', 'openai', 'anthropic', 'gemini', 'openai-compatible']).optional(),
  llmModel: z.string().min(1).max(200).optional(),
  llmApiKey: z.string().min(1).max(500).optional(),
  llmBaseUrl: z.string().url().max(500).optional(),
});

export function aiSettingsRoutes(
  app: FastifyInstance,
  options: { embedding: RuntimeEmbeddingProvider; llm: RuntimeLLMProvider },
): void {
  app.get('/settings/ai', async (_request, reply) =>
    reply.send({ ...options.embedding.getSettings(), ...options.llm.getSettings() }),
  );
  app.put('/settings/ai', async (request, reply) => {
    const input = parseWith(updateSchema, request.body);
    try {
      if (
        input.embeddingProvider ||
        input.embeddingModel ||
        input.embeddingApiKey ||
        input.embeddingBaseUrl
      )
        options.embedding.configure({
          provider: input.embeddingProvider ?? options.embedding.getSettings().embeddingProvider,
          model: input.embeddingModel ?? options.embedding.getSettings().embeddingModel,
          apiKey: input.embeddingApiKey,
          baseUrl: input.embeddingBaseUrl,
        });
      if (input.llmProvider || input.llmModel || input.llmApiKey || input.llmBaseUrl)
        options.llm.configure({
          provider: input.llmProvider ?? options.llm.getSettings().llmProvider,
          model: input.llmModel ?? options.llm.getSettings().llmModel,
          apiKey: input.llmApiKey,
          baseUrl: input.llmBaseUrl,
        });
      return reply.send({ ...options.embedding.getSettings(), ...options.llm.getSettings() });
    } catch (error) {
      return reply.status(400).send({
        statusCode: 400,
        code: 'AI_SETTINGS_INVALID',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

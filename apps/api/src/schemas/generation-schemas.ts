import { z } from 'zod';

export const generateRequestSchema = z.object({
  query: z.string().min(1).max(10000),
  topK: z.coerce.number().int().min(1).max(100).optional(),
  systemPrompt: z.string().min(1).max(5000).optional(),
  documentId: z.string().uuid().optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

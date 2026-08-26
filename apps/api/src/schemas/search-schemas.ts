import { z } from 'zod';

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(10000),
  topK: z.coerce.number().int().min(1).max(100).default(5).optional(),
  documentId: z.string().uuid().optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

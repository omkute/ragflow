import { z } from 'zod';

export const createDocumentSchema = z.object({
  filename: z.string().min(1).max(512),
  /**
   * Optional: derived from the filename extension when omitted.
   * Kept as free-form string so unsupported types surface as 415
   * (UnsupportedDocumentTypeError) instead of a validation 400.
   */
  contentType: z.string().min(1).max(128).optional(),
  content: z.string().min(1).max(5_000_000),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const reindexDocumentSchema = z.object({
  filename: z.string().min(1).max(512).optional(),
  contentType: z.string().min(1).max(128).optional(),
  content: z.string().min(1).max(5_000_000),
});

export type ReindexDocumentInput = z.infer<typeof reindexDocumentSchema>;

export const listDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

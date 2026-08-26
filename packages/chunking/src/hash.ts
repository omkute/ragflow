import { createHash } from 'node:crypto';
import { normalizeText } from '@indexa/document-processing';

/**
 * Deterministic content identity for chunks:
 * SHA-256 hex digest over *normalized* chunk text, matching the hashing
 * strategy used for document_versions.content_hash.
 */
export function chunkContentHash(content: string): string {
  return createHash('sha256').update(normalizeText(content)).digest('hex');
}

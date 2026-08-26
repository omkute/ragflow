import { createHash } from 'node:crypto';
import { normalizeText } from './normalize';

/**
 * Deterministic content identity for documents and chunks:
 * SHA-256 hex digest over *normalized* text (never raw formatting that
 * normalization removes). Lowercase hex, 64 characters.
 */
export function contentHash(text: Buffer | string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

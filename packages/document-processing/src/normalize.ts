/**
 * Deterministic text normalization applied before hashing.
 *
 * Strategy (keep conservative so Markdown semantics are not destroyed):
 * - decode as UTF-8
 * - normalize CRLF / lone CR to LF
 * - strip BOM and zero-width characters
 * - collapse runs of 3+ consecutive newlines to exactly two (one blank line)
 * - trim leading/trailing whitespace of the whole text
 *
 * Intra-line whitespace is intentionally preserved (code blocks, tables,
 * hard line breaks). Same input always produces the same output; content
 * hashes must be computed over this normalized form, never raw bytes.
 */

const ZERO_WIDTH_CHARS = /\u200B|\u200C|\u200D|\uFEFF/g;
const THREE_PLUS_NEWLINES = /\n{3,}/g;

export function normalizeText(raw: Buffer | string): string {
  const decoded = typeof raw === 'string' ? raw : raw.toString('utf8');

  return decoded
    .replace(ZERO_WIDTH_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(THREE_PLUS_NEWLINES, '\n\n')
    .trim();
}

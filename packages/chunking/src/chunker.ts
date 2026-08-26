import type { ParsedDocument } from '@indexa/document-processing';
import { chunkContentHash } from './hash';
import { tokenize } from './tokenizer';
import type { Chunk, Chunker, ChunkerConfig } from './types';

function validateConfig(config: ChunkerConfig): void {
  if (!Number.isInteger(config.chunkSize) || config.chunkSize < 1) {
    throw new Error(`chunkSize must be an integer >= 1 (got ${config.chunkSize})`);
  }
  if (!Number.isInteger(config.chunkOverlap) || config.chunkOverlap < 0) {
    throw new Error(`chunkOverlap must be an integer >= 0 (got ${config.chunkOverlap})`);
  }
  if (config.chunkOverlap >= config.chunkSize) {
    throw new Error(
      `chunkOverlap (${config.chunkOverlap}) must be < chunkSize (${config.chunkSize})`,
    );
  }
}

const HEADING_RE = /^#{1,6}\s+(.+)$/gm;

/**
 * Extract headings with their token position in the document.
 * Token position is the count of whitespace-separated tokens preceding the
 * heading in the original document text, giving a deterministic mapping
 * between document structure and chunk windows.
 */
function headingPositions(text: string): Array<{ heading: string; tokenPos: number }> {
  const positions: Array<{ heading: string; tokenPos: number }> = [];
  for (const match of text.matchAll(HEADING_RE)) {
    const heading = match[1]?.trim();
    if (!heading) continue;
    const charIndex = match.index ?? 0;
    const prefix = text.slice(0, charIndex);
    const tokenPos = tokenize(prefix).length;
    positions.push({ heading, tokenPos });
  }
  return positions;
}

/**
 * Deterministic, token-aware chunker with sliding window and overlap.
 *
 * Invariant: same (input text, metadata, config) -> same chunks byte-for-byte.
 *
 * Algorithm:
 *  - tokenize document.text via whitespace split
 *  - sliding window of `chunkSize` tokens with step `chunkSize - chunkOverlap`
 *  - each chunk content = tokens.slice(start, start+chunkSize).join(' ')
 *  - metadata propagation: inherits ParsedDocument.metadata, plus chunkIndex,
 *    tokenCount, and nearest heading (last heading seen in document order)
 */
export class TokenChunker implements Chunker {
  private readonly config: ChunkerConfig;

  constructor(config: ChunkerConfig) {
    validateConfig(config);
    this.config = { ...config };
  }

  async chunk(document: ParsedDocument): Promise<Chunk[]> {
    const tokens = tokenize(document.text);
    if (tokens.length === 0) return [];

    const step = this.config.chunkSize - this.config.chunkOverlap;
    const chunks: Chunk[] = [];
    const headings = headingPositions(document.text);
    // Fallback heading from metadata title when no markdown heading precedes start.
    const fallbackHeading =
      typeof document.metadata.title === 'string' ? (document.metadata.title as string) : undefined;

    for (let start = 0; start < tokens.length; start += step) {
      const slice = tokens.slice(start, start + this.config.chunkSize);
      if (slice.length === 0) break;

      const content = slice.join(' ');
      const contentHash = chunkContentHash(content);
      const tokenCount = slice.length;
      const chunkIndex = chunks.length;

      // Determine nearest heading whose token position is <= chunk start.
      let heading: string | undefined;
      for (let i = headings.length - 1; i >= 0; i--) {
        const entry = headings[i];
        if (entry && entry.tokenPos <= start) {
          heading = entry.heading;
          break;
        }
      }
      if (heading === undefined) heading = fallbackHeading;

      const metadata: Record<string, unknown> = {
        ...document.metadata,
        chunkIndex,
        tokenCount,
      };
      if (heading !== undefined) {
        metadata.heading = heading;
      }

      chunks.push({
        chunkIndex,
        content,
        contentHash,
        tokenCount,
        metadata,
      });
    }

    return chunks;
  }
}

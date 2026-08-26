import type { ParsedDocument } from '@indexa/document-processing';

/**
 * Configuration for deterministic token-aware chunking.
 * Same input + same config must always produce the same chunks.
 */
export interface ChunkerConfig {
  /** Desired chunk size in tokens (words). Must be >= 1. */
  chunkSize: number;
  /** Number of tokens that overlap between consecutive chunks. Must be < chunkSize. */
  chunkOverlap: number;
}

/**
 * A single chunk returned by the chunker. Hashing and token counting are
 * deterministic; content is already normalized via the parent document.
 */
export interface Chunk {
  /** Zero-based position within the document's chunk sequence. */
  chunkIndex: number;
  /** Normalized chunk text (tokens joined with single spaces). */
  content: string;
  /** SHA-256 hex over normalized content (lowercase, 64 chars). */
  contentHash: string;
  /** Number of tokens in this chunk (== content.split(/\s+/).length). */
  tokenCount: number;
  /** Propagated document metadata plus chunk-specific fields. */
  metadata: Record<string, unknown>;
}

export interface Chunker {
  chunk(document: ParsedDocument): Promise<Chunk[]>;
}

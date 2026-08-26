/**
 * Provider abstraction for embedding generation.
 * Business logic (chunking, indexing, retrieval) must not depend on a
 * specific vendor SDK; all provider-specific code stays behind this interface.
 */
export interface EmbeddingProvider {
  /** Batch-embed multiple document chunks. */
  embedDocuments(texts: string[]): Promise<number[][]>;

  /** Embed a single query string for retrieval. */
  embedQuery(text: string): Promise<number[]>;
}

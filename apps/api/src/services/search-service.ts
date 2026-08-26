import type { EmbeddingProvider } from '@indexa/embeddings';
import { EmbeddingProviderError, RetrievalError } from '../errors';
import type { SearchRepository } from '../repositories/search-repository';

export interface SearchInput {
  query: string;
  topK: number;
  documentId?: string;
}

export interface SearchOutput {
  query: string;
  results: Array<{
    chunkId: string;
    documentId: string;
    documentVersionId: string;
    chunkIndex: number;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
  }>;
}

/**
 * Retrieval pipeline:
 * Query -> Query embedding (provider) -> pgvector cosine search -> Top-K
 *
 * Business logic lives here; HTTP concerns stay in the route handler.
 * Embedder and DB are injected for testability (fake provider in tests).
 */
export class SearchService {
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly searchRepository: SearchRepository;

  constructor(options: {
    embeddingProvider: EmbeddingProvider;
    searchRepository: SearchRepository;
  }) {
    this.embeddingProvider = options.embeddingProvider;
    this.searchRepository = options.searchRepository;
  }

  async search(input: SearchInput): Promise<SearchOutput> {
    const { query, topK, documentId } = input;

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingProvider.embedQuery(query);
    } catch (error) {
      throw new EmbeddingProviderError('Failed to embed query', error);
    }

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      throw new RetrievalError('Embedding provider returned empty query vector');
    }

    try {
      const hits = await this.searchRepository.search({
        queryEmbedding,
        topK,
        documentId,
      });

      return {
        query,
        results: hits.map((hit) => ({
          chunkId: hit.chunkId,
          documentId: hit.documentId,
          documentVersionId: hit.documentVersionId,
          chunkIndex: hit.chunkIndex,
          content: hit.content,
          score: hit.score,
          metadata: hit.metadata,
        })),
      };
    } catch (error) {
      if (error instanceof EmbeddingProviderError) throw error;
      throw new RetrievalError('Vector search failed', error);
    }
  }
}

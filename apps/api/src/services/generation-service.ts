import type { LLMProvider } from '@indexa/llm';
import { LLMProviderError } from '../errors';
import type { SearchService } from './search-service';

export interface GenerateInput {
  query: string;
  topK?: number;
  systemPrompt?: string;
  documentId?: string;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface GenerateOutput {
  query: string;
  answer: string;
  citations: Citation[];
  retrievedCount: number;
}

export class GenerationService {
  private readonly searchService: SearchService;
  private readonly llmProvider: LLMProvider;
  private readonly defaultTopK: number;

  constructor(options: {
    searchService: SearchService;
    llmProvider: LLMProvider;
    defaultTopK: number;
  }) {
    this.searchService = options.searchService;
    this.llmProvider = options.llmProvider;
    this.defaultTopK = options.defaultTopK;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const topK = input.topK ?? this.defaultTopK;

    const searchResult = await this.searchService.search({
      query: input.query,
      topK,
      documentId: input.documentId,
    });

    const citations: Citation[] = searchResult.results.map((hit) => ({
      chunkId: hit.chunkId,
      documentId: hit.documentId,
      documentVersionId: hit.documentVersionId,
      chunkIndex: hit.chunkIndex,
      content: hit.content,
      score: hit.score,
      metadata: hit.metadata,
    }));

    // Build deterministic context: each chunk prefixed with [n]
    const contextParts = citations.map((c, idx) => `[${idx + 1}] ${c.content}`);
    const context =
      contextParts.length > 0 ? contextParts.join('\n\n') : 'No relevant context found.';

    const prompt = `Context:\n${context}\n\nQuestion: ${input.query}\n\nProvide an answer using only the context above. Cite sources with [n] markers. If context is insufficient, say so.`;

    let answer: string;
    try {
      answer = await this.llmProvider.generate({
        system: input.systemPrompt,
        prompt,
      });
    } catch (error) {
      throw new LLMProviderError('Failed to generate answer', error);
    }

    return {
      query: input.query,
      answer,
      citations,
      retrievedCount: citations.length,
    };
  }
}

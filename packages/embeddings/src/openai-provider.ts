import type { EmbeddingProvider } from './provider';

interface OpenAIEmbeddingResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  error?: { message?: string };
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      dimension: number;
      baseUrl?: string;
    },
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.request(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.request([text]);
    if (!embedding) throw new Error('OpenAI returned no query embedding');
    return embedding;
  }

  private async request(input: string[]): Promise<number[][]> {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://api.openai.com/v1'}/embeddings`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: this.options.model, input }),
      },
    );
    const payload = (await response.json()) as OpenAIEmbeddingResponse;
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? `OpenAI embeddings request failed (${response.status})`,
      );
    const rows = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);
    if (
      rows.length !== input.length ||
      rows.some((row) => row.embedding.length !== this.options.dimension)
    ) {
      throw new Error(
        `OpenAI embedding dimension/count did not match expected ${this.options.dimension}`,
      );
    }
    return rows.map((row) => row.embedding);
  }
}

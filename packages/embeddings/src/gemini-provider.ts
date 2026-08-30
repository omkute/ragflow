import type { EmbeddingProvider } from './provider';

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
  error?: { message?: string };
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      dimension: number;
      baseUrl?: string;
    },
  ) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'}/models/${this.options.model}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.options.model}`,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
          })),
        }),
      },
    );
    const payload = (await response.json()) as GeminiEmbeddingResponse;
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? `Gemini embeddings request failed (${response.status})`,
      );
    const values = (payload.embeddings ?? []).map((item) => item.values ?? []);
    if (
      values.length !== texts.length ||
      values.some((item) => item.length !== this.options.dimension)
    )
      throw new Error(
        `Gemini embedding dimension/count did not match expected ${this.options.dimension}`,
      );
    return values;
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await fetch(
      `${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'}/models/${this.options.model}:embedContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.options.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: `models/${this.options.model}`,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
        }),
      },
    );
    const payload = (await response.json()) as GeminiEmbeddingResponse;
    if (!response.ok)
      throw new Error(
        payload.error?.message ?? `Gemini embedding request failed (${response.status})`,
      );
    const values = payload.embedding?.values ?? [];
    if (values.length !== this.options.dimension)
      throw new Error(
        `Gemini query embedding dimension did not match expected ${this.options.dimension}`,
      );
    return values;
  }
}

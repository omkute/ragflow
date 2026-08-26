import type { EmbeddingProvider } from './provider';

/**
 * Deterministic fake embedding provider for tests and local development.
 *
 * - Deterministic: same input + same dimension -> same vector.
 * - Unit-ish: output vectors are L2-normalized for stable cosine similarity.
 * - Counting: exposes `calls` and `totalChunksEmbedded` for incremental-index tests.
 * - Zero external I/O, no API keys.
 *
 * Vector construction: for each dimension `i`, hash the input text + i via a
 * simple FNV-like mix, then map to [-1, 1] range and normalize.
 * This is intentionally cheap and reproducible — retrieval tests assert on
 * similarity ordering, not embedding quality.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;

  /** Number of times embedDocuments / embedQuery was invoked. */
  calls = 0;

  /** Total count of document texts embedded via embedDocuments. */
  totalChunksEmbedded = 0;

  /** All inputs seen (useful for assertions). */
  callsLog: Array<{ type: 'documents' | 'query'; inputs: string[] }> = [];

  constructor(options: { dimension: number }) {
    if (!Number.isInteger(options.dimension) || options.dimension < 1) {
      throw new Error(`dimension must be integer >= 1 (got ${options.dimension})`);
    }
    this.dimension = options.dimension;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls += 1;
    this.totalChunksEmbedded += texts.length;
    this.callsLog.push({ type: 'documents', inputs: [...texts] });

    if (texts.length === 0) return [];

    return texts.map((text) => this.embedOne(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    this.calls += 1;
    this.callsLog.push({ type: 'query', inputs: [text] });
    return this.embedOne(text);
  }

  resetCounts(): void {
    this.calls = 0;
    this.totalChunksEmbedded = 0;
    this.callsLog = [];
  }

  // Compatibility alias for older tests
  resetCalls(): void {
    this.resetCounts();
  }

  getCalls(): number {
    return this.calls;
  }

  private embedOne(text: string): number[] {
    // Token-aware deterministic embedding: average per-token random vectors
    // so that queries sharing keywords with documents rank higher than
    // unrelated documents. Keeps exact-match score = 1 (identical token sets).
    const tokens = text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const effectiveTokens = tokens.length > 0 ? tokens : [text.toLowerCase()];

    const vec: number[] = new Array(this.dimension).fill(0);

    for (const token of effectiveTokens) {
      const tokenHash = fnv1a(token);
      for (let i = 0; i < this.dimension; i++) {
        const mixed = fnv1a(`${tokenHash}:${i}`);
        const normalized = (mixed / 0xffffffff) * 2 - 1;
        vec[i] = (vec[i] ?? 0) + normalized;
      }
    }

    // Average across tokens
    for (let i = 0; i < this.dimension; i++) {
      vec[i] = (vec[i] ?? 0) / effectiveTokens.length;
    }

    // L2 normalize so cosine similarity is meaningful (dot product of normalized vectors).
    const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime 16777619, keep 32-bit
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

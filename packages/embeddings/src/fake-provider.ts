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
    // Seed from text hash (FNV-1a 32-bit), then perturb per-dimension.
    const base = fnv1a(text);

    const vec: number[] = new Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      // Mix base + i into a pseudo-random float in [-1, 1].
      const mixed = fnv1a(`${base}:${i}`);
      // Map uint32 -> [-1, 1]
      const normalized = (mixed / 0xffffffff) * 2 - 1;
      vec[i] = normalized;
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

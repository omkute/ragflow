export interface EvaluationCase {
  id: string;
  question: string;
  /** Query string actually sent to retrieval (may differ from question for experiments). */
  query: string;
  /** Filenames expected to be relevant (e.g. ["authentication.md"]). */
  expectedDocuments: string[];
  /** Optional per-case topK override; falls back to global default. */
  topK?: number;
}

export interface RetrievalHit {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  /** Resolved filename from documents table for evaluation. */
  filename?: string;
}

export interface QueryMetrics {
  caseId: string;
  query: string;
  topK: number;
  retrievedCount: number;
  recallAtK: number;
  precisionAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
  latencyMs: number;
}

export interface AggregateMetrics {
  count: number;
  topK: number;
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

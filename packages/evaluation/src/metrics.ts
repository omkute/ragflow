/**
 * Retrieval quality metrics for Indexa evaluation.
 *
 * All functions operate on document-level relevance: a retrieved chunk is
 * relevant if its owning document filename is in the expected set.
 * This mirrors the dataset's `expectedDocuments` which lists filenames.
 *
 * Metrics:
 * - Recall@K: |retrieved ∩ expected| / |expected|
 * - Precision@K: |retrieved ∩ expected| / K
 * - Reciprocal Rank (RR): 1 / rank of first relevant doc, 0 if none
 * - MRR: mean RR across queries
 * - nDCG@K: normalized discounted cumulative gain (binary relevance)
 */

export function recallAtK(
  retrievedFilenames: string[],
  expectedFilenames: string[],
  k: number,
): number {
  if (expectedFilenames.length === 0) return 0;
  const topK = retrievedFilenames.slice(0, k);
  const relevantRetrieved = expectedFilenames.filter((doc) => topK.includes(doc)).length;
  return relevantRetrieved / expectedFilenames.length;
}

export function precisionAtK(
  retrievedFilenames: string[],
  expectedFilenames: string[],
  k: number,
): number {
  if (k === 0) return 0;
  const topK = retrievedFilenames.slice(0, k);
  const relevantRetrieved = expectedFilenames.filter((doc) => topK.includes(doc)).length;
  return relevantRetrieved / k;
}

export function reciprocalRank(retrievedFilenames: string[], expectedFilenames: string[]): number {
  const expectedSet = new Set(expectedFilenames);
  for (let i = 0; i < retrievedFilenames.length; i++) {
    const fname = retrievedFilenames[i];
    if (fname && expectedSet.has(fname)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function dcgAtK(
  retrievedFilenames: string[],
  expectedFilenames: string[],
  k: number,
): number {
  const expectedSet = new Set(expectedFilenames);
  let dcg = 0;
  const topK = retrievedFilenames.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    const fname = topK[i];
    const rel = fname && expectedSet.has(fname) ? 1 : 0;
    if (rel === 1) {
      // Rank is 1-indexed for DCG: i+1
      dcg += rel / Math.log2(i + 2); // i=0 -> log2(2)=1
    }
  }
  return dcg;
}

export function idealDcgAtK(expectedCount: number, k: number): number {
  const n = Math.min(expectedCount, k);
  let idcg = 0;
  for (let i = 0; i < n; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg;
}

export function ndcgAtK(
  retrievedFilenames: string[],
  expectedFilenames: string[],
  k: number,
): number {
  const idcg = idealDcgAtK(expectedFilenames.length, k);
  if (idcg === 0) return 0;
  const dcg = dcgAtK(retrievedFilenames, expectedFilenames, k);
  return dcg / idcg;
}

export interface Aggregated {
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export function aggregateMetrics(
  values: { recallAtK: number; precisionAtK: number; reciprocalRank: number; ndcgAtK: number }[],
): Aggregated {
  if (values.length === 0) {
    return { recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 };
  }
  const sum = values.reduce(
    (acc, v) => ({
      recallAtK: acc.recallAtK + v.recallAtK,
      precisionAtK: acc.precisionAtK + v.precisionAtK,
      mrr: acc.mrr + v.reciprocalRank,
      ndcgAtK: acc.ndcgAtK + v.ndcgAtK,
    }),
    { recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 },
  );
  return {
    recallAtK: sum.recallAtK / values.length,
    precisionAtK: sum.precisionAtK / values.length,
    mrr: sum.mrr / values.length,
    ndcgAtK: sum.ndcgAtK / values.length,
  };
}

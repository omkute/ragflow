/**
 * Minimal token estimator for deterministic chunking.
 *
 * Uses whitespace splitting as a token proxy. This keeps the chunker
 * deterministic and dependency-free while preserving token-aware
 * boundaries (no arbitrary character slicing).
 *
 * A production swap (e.g. tiktoken) can replace these helpers behind
 * the same interface without changing the chunking algorithm.
 */

export function tokenize(text: string): string[] {
  if (text.trim().length === 0) return [];
  // Split on any whitespace run, drop empty strings produced by leading/trailing splits.
  return text.split(/\s+/).filter((token) => token.length > 0);
}

export function countTokens(text: string): number {
  return tokenize(text).length;
}

import { describe, expect, test } from 'bun:test';
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from '../src/metrics';

describe('recallAtK', () => {
  test('returns 1 when all expected are in topK', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBe(1);
  });

  test('returns 0.5 when half are retrieved', () => {
    expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBe(0.5);
  });

  test('returns 0 when none retrieved', () => {
    expect(recallAtK(['x', 'y'], ['a', 'b'], 2)).toBe(0);
  });

  test('respects K truncation', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 1)).toBe(0.5);
  });

  test('0 when expected empty', () => {
    expect(recallAtK(['a'], [], 1)).toBe(0);
  });
});

describe('precisionAtK', () => {
  test('computes precision correctly', () => {
    expect(precisionAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBeCloseTo(1 / 3);
  });

  test('0 when k=0', () => {
    expect(precisionAtK(['a'], ['a'], 0)).toBe(0);
  });
});

describe('reciprocalRank', () => {
  test('returns 1 for rank 1', () => {
    expect(reciprocalRank(['a', 'x'], ['a'])).toBe(1);
  });

  test('returns 0.5 for rank 2', () => {
    expect(reciprocalRank(['x', 'a'], ['a'])).toBe(0.5);
  });

  test('returns 0 when not found', () => {
    expect(reciprocalRank(['x', 'y'], ['a'])).toBe(0);
  });

  test('picks first relevant when multiple', () => {
    expect(reciprocalRank(['x', 'b', 'a'], ['a', 'b'])).toBe(0.5);
  });
});

describe('ndcgAtK', () => {
  test('perfect ranking yields 1', () => {
    expect(ndcgAtK(['a', 'b'], ['a', 'b'], 2)).toBeCloseTo(1);
  });

  test('worse ranking lower ndcg', () => {
    const perfect = ndcgAtK(['a', 'b'], ['a', 'b'], 2);
    const swapped = ndcgAtK(['b', 'a'], ['a', 'b'], 2);
    // Both are perfect at K=2 for binary relevance with 2 expected? Actually order doesn't affect ndcg when both are relevant and K covers all
    // Use case where only one of two is relevant at top
    const ndcgFirst = ndcgAtK(['a', 'x'], ['a', 'b'], 2);
    const ndcgSecond = ndcgAtK(['x', 'a'], ['a', 'b'], 2);
    expect(ndcgFirst).toBeGreaterThan(ndcgSecond);
    expect(perfect).toBe(1);
    expect(swapped).toBe(1);
  });

  test('no relevant yields 0', () => {
    expect(ndcgAtK(['x', 'y'], ['a', 'b'], 2)).toBe(0);
  });

  test('single relevant at rank 2', () => {
    // DCG = 1/log2(3) ≈0.6309, IDCG for 1 expected =1, so ndcg≈0.6309
    expect(ndcgAtK(['x', 'a'], ['a'], 2)).toBeCloseTo(1 / Math.log2(3));
  });
});

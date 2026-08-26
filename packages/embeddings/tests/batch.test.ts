import { describe, expect, test } from 'bun:test';
import { batchedEmbed, chunkArray } from '../src/batch';
import { FakeEmbeddingProvider } from '../src/fake-provider';

describe('chunkArray', () => {
  test('splits evenly and with remainder', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
    expect(chunkArray([], 2)).toEqual([]);
  });
});

describe('batchedEmbed', () => {
  test('preserves order and calls provider in batches', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 4 });
    const texts = ['a', 'b', 'c', 'd', 'e'];
    const vectors = await batchedEmbed(provider, texts, 2);
    expect(vectors).toHaveLength(5);
    expect(provider.calls).toBe(3); // 2 + 2 + 1
    expect(provider.totalChunksEmbedded).toBe(5);
  });

  test('returns empty array for empty input without calling provider', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 4 });
    expect(await batchedEmbed(provider, [], 10)).toEqual([]);
    expect(provider.calls).toBe(0);
  });
});

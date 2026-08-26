import { describe, expect, test } from 'bun:test';
import { FakeEmbeddingProvider } from '../src/fake-provider';

describe('FakeEmbeddingProvider', () => {
  test('is deterministic: same text -> same vector', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 8 });
    const [vec1] = await provider.embedDocuments(['hello world']);
    const [vec2] = await provider.embedDocuments(['hello world']);
    expect(vec1).toEqual(vec2);
  });

  test('different text -> different vectors', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 8 });
    const [vecA] = await provider.embedDocuments(['hello']);
    const [vecB] = await provider.embedDocuments(['world']);
    expect(vecA).not.toEqual(vecB);
  });

  test('vectors are unit length', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 8 });
    const [vec] = await provider.embedDocuments(['test']);
    const norm = Math.sqrt(vec!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test('embedQuery matches embedDocuments for same text', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 8 });
    const [docVec] = await provider.embedDocuments(['query text']);
    const queryVec = await provider.embedQuery('query text');
    expect(docVec).toEqual(queryVec);
  });

  test('tracks calls and totalChunksEmbedded', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 4 });
    await provider.embedDocuments(['a', 'b', 'c']);
    expect(provider.calls).toBe(1);
    expect(provider.totalChunksEmbedded).toBe(3);
    await provider.embedDocuments(['d', 'e']);
    expect(provider.calls).toBe(2);
    expect(provider.totalChunksEmbedded).toBe(5);
  });

  test('respects configured dimension', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 3 });
    const [vec] = await provider.embedDocuments(['hello']);
    expect(vec).toHaveLength(3);
  });

  test('batch call returns one vector per input', async () => {
    const provider = new FakeEmbeddingProvider({ dimension: 4 });
    const vectors = await provider.embedDocuments(['a', 'b', 'c', 'd', 'e']);
    expect(vectors).toHaveLength(5);
    for (const v of vectors) expect(v).toHaveLength(4);
  });
});

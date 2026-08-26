export function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export async function batchedEmbed(
  provider: { embedDocuments: (texts: string[]) => Promise<number[][]> },
  texts: string[],
  batchSize = 100,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches = chunkArray(texts, batchSize);
  const results: number[][] = [];
  for (const batch of batches) {
    const vecs = await provider.embedDocuments(batch);
    results.push(...vecs);
  }
  return results;
}

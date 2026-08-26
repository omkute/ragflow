# Embeddings

Indexa isolates AI providers behind an `EmbeddingProvider` interface with `embedDocuments(texts: string[])` and `embedQuery(text: string)`. Provider SDK code is confined to the provider package.

## Provider abstraction

```ts
interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
```

Batch embedding is supported: do not make one API request per chunk if the provider supports batching. FakeEmbeddingProvider is used in tests and local development — deterministic FNV-based L2-normalized vectors.

## Metrics

Track embedding_requests, embedding_chunks, embedding_failures, embedding_latency, chunks_reused, chunks_reembedded and the derived embedding_reuse_rate.

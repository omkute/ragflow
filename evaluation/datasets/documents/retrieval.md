# Retrieval

Indexa stores vectors in PostgreSQL with pgvector (`vector(1536)`). Retrieval is `Query → Query embedding → pgvector cosine similarity search → Top-K results`.

## API

```
POST /search
{ "query": "How does authentication work?", "topK": 5 }
```

Response includes `chunkId`, `documentId`, `content`, `score` (cosine similarity, 1 is exact match for normalized vectors), and `metadata`. Requests are validated with Zod and bound `topK` 1–100.

## Quality

Do not judge quality by whether an LLM produces a plausible answer. Instead use an evaluation dataset with `Recall@K` and `MRR`. Store datasets version-controlled in `evaluation/datasets/`.

## Indexing for retrieval

Documents are chunked with configurable overlap to preserve context across boundaries. Larger chunks provide more context but may dilute relevance; measure Recall@5 and MRR across configurations to choose.

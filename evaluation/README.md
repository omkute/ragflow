# Evaluation — Retrieval Quality

This folder holds the retrieval evaluation harness for Milestone 9.

## Datasets

- `datasets/retrieval.json` — 6 questions with `query` + `expectedDocuments` (filenames). Version-controlled.
- `datasets/documents/*.md` — 5 synthetic documents that provide ground-truth for the dataset.

## Metrics

Implemented in `@indexa/evaluation`:
- **Recall@K** — relevant docs retrieved / relevant docs expected
- **Precision@K** — relevant docs retrieved / K
- **MRR (Mean Reciprocal Rank)** — mean 1/rank of first relevant doc (0 if none)
- **nDCG@K** — normalized discounted cumulative gain (binary relevance)
- **Latency** — avg / p50 / p95 per query

## Running

```bash
bun run evaluate                 # default topK 5, ingests missing docs inline
bun run evaluate -- --topK 10    # custom K
CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate   # chunking experiment
```

The runner ensures referenced documents are ingested (inline, no worker needed), builds a filename→documentId map, runs each query via `SearchService` (pgvector cosine), and writes a benchmark JSON to `evaluation/benchmarks/<stamp>-kc<CHUNK>o<OVERLAP>.json`.

## Chunking experiments

Change `CHUNK_SIZE`/`CHUNK_OVERLAP` in `.env` or via env prefix and re-run:

```bash
CHUNK_SIZE=512 CHUNK_OVERLAP=64 bun run evaluate > bench-512-64.json
CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate > bench-256-32.json
diff bench-*.json
```

Compare `recallAtK`, `mrr`, `avgLatencyMs`, `embeddingCount` etc.

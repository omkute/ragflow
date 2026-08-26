# Indexa

Incremental RAG indexing & retrieval infrastructure.

Indexa ingests documents, chunks them deterministically, embeds them into PostgreSQL
(pgvector), and — its defining feature — **reuses embeddings for unchanged chunks**
when documents change, re-embedding only what actually differs. Ingestion is
**asynchronous, idempotent and retry-safe** (BullMQ at-least-once, exponential
backoff, unique constraints).

> Status: **Milestone 8 — Reliability** complete (M7 async, M6 incremental, M5 vector
> search, M4 embeddings, M3 chunking). See `CLAUDE.md` for spec, `handover.md` for
> current state.

## Stack

| Concern     | Technology                          |
| ----------- | ----------------------------------- |
| Runtime     | Bun + TypeScript                    |
| API         | Fastify + Zod                       |
| Async jobs  | BullMQ + Redis (single `ingestion` queue) |
| Database    | PostgreSQL + pgvector + Drizzle ORM |
| Infra       | Docker Compose                      |
| Tests/Lint  | `bun test`, Biome                   |

## Layout

```
apps/
  api/       Fastify API (health, documents, jobs, search)
  worker/    BullMQ ingestion worker (idempotent, incremental)
packages/
  db/        Drizzle schema/migrations, pgvector
  document-processing/  parsers, normalization, SHA-256 hashing
  chunking/  deterministic TokenChunker
  embeddings/  provider interface, FakeEmbeddingProvider, batch
evaluation/  (next) retrieval benchmarks
```

## Documents & Jobs API

```bash
# Upload — returns 201 (inline completed in test) or 202 (queued) with job
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"notes.md","content":"# Title\n\nBody text"}' | jq

curl -s http://127.0.0.1:3000/documents            # list (limit/offset)
curl -s http://127.0.0.1:3000/documents/<id>       # detail incl. normalized content
curl -s http://127.0.0.1:3000/documents/<id>/chunks | jq
curl -s -X POST http://127.0.0.1:3000/documents/<id>/reindex \
  -H 'content-type: application/json' \
  -d '{"content":"# Updated\n\nNew body"}' | jq

curl -s http://127.0.0.1:3000/jobs/<jobId> | jq   # queued|processing|completed|failed
curl -s -X DELETE http://127.0.0.1:3000/documents/<id>

# Search (pgvector cosine)
curl -s -X POST http://127.0.0.1:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"how does chunking work?","topK":5}' | jq
```

Upload flow: validate (Zod) → parse → normalize → SHA-256 hash → txn `documents`+`document_versions`+`ingestion_jobs(queued)` → enqueue BullMQ `jobId=ingestionJobId` (deduplicated) → worker chunks → incremental embedding reuse → upsert `chunks` → mark `ready`/`completed`. Retries use exponential backoff; concurrent workers rely on `(document_version_id,chunk_index)` unique upsert.

Reliability: `POST /documents` is idempotent per version, `processIngestionJob` is at-least-once safe, `GET /jobs/:id` is source of truth, `attempts/error` tracked.

## Getting started

```bash
bun install                 # install dependencies
docker compose up -d --wait # start PostgreSQL (+pgvector) and Redis
cp .env.example .env        # configure DATABASE_URL, REDIS_URL, VECTOR_DIMENSION etc

bun run db:migrate          # apply migrations (enables pgvector, creates ingestion_jobs, vector(1536))
bun run dev:api             # http://127.0.0.1:3000
bun run dev:worker          # starts ingestion worker (concurrency 2)
```

## Commands

| Command              | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `bun run dev:api`    | Run API with watch/reload                |
| `bun run dev:worker` | Run worker with watch/reload             |
| `bun run test`       | Run all tests (`bun test`)               |
| `bun run typecheck`  | TypeScript project check                 |
| `bun run lint`       | Biome lint/format check                  |
| `bun run format`     | Biome format write                       |
| `bun run db:migrate` | Apply Drizzle migrations                 |
| `bun run db:generate`| Generate migrations from schema changes  |
| `bun run infra:up`   | Start PostgreSQL + Redis via Compose     |
| `bun run infra:down` | Stop infrastructure                      |

## Health endpoint

```bash
curl -s http://127.0.0.1:3000/health | jq
```

Returns `200` with per-dependency checks (`postgres`, `pgvector`, `redis`), or `503` degraded.

## Testing notes

Integration tests require running infrastructure (`DATABASE_URL` / `REDIS_URL` set, e.g. via `.env`); they skip when absent. Reliability suite covers idempotency (same job twice → no duplicates), concurrency (`Promise.allSettled` dual workers), retry (flaky provider timeout→failed→retry→completed), job API polling, BullMQ exponential backoff config.

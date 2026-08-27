# Working — Deploy, Load Data & Operations

> Indexa — Incremental RAG Infrastructure (M1-M10 complete)
> Stack: Bun + TS, Fastify + Zod, BullMQ + Redis, Postgres + pgvector, Drizzle

---

## 1. Deploy Checklist (local in 5 minutes)

```bash
# 0) prerequisites
bun --version          # >=1.1
docker --version
psql --version         # optional for inspection (PGPASSWORD=indexa)

# 1) install
bun install

# 2) env
cp .env.example .env   # edit if you need custom PG/Redis/ports
cat .env               # must have DATABASE_URL, REDIS_URL

# 3) infra (pgvector/pg16 + redis:7)
bun run infra:up       # docker compose up -d --wait
docker compose ps      # both Healthy
bun run infra:logs     # follow if needed, then Ctrl-C

# 4) migrations (0000 pgvector → 0004 vector(1536)+ingestion_jobs)
bun run db:migrate
# verify: PGPASSWORD=indexa psql -h localhost -U indexa -d indexa -c "\dt"
# should list documents, document_versions, chunks, ingestion_jobs

# 5) start services (2 terminals in dev)
bun run dev:api         # http://127.0.0.1:3000  (Fastify, LOG_LEVEL=info)
bun run dev:worker      # BullMQ ingestion worker, WORKER_CONCURRENCY=2

# 6) health
curl -s http://127.0.0.1:3000/health | jq
# {"status":"ok","checks":{"postgres":{"ok":true,"latencyMs":...},"pgvector":{...},"redis":{...}}}
# 200 = ok, 503 = degraded (check docker logs)

# 7) smoke test
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"hello.md","content":"# Hello\n\nWorld"}' | jq
# → 201 with {id, version:{contentHash}, ingestionJob:{id,status}} or 201+completed in test

# 8) quality gates (local CI)
bun run typecheck   # tsc --noEmit
bun run lint        # biome check
bun test            # 107 pass (requires infra up; skips if no DATABASE_URL)
bun run evaluate    # retrieval Recall@K/MRR, writes evaluation/benchmarks/*.json
```

Update after pull: `bun install && bun run db:migrate && bun run dev:api` — restart worker if `WORKER_CONCURRENCY`/`CHUNK_*` changed.

Prod start (no watch): `bun run start:api` and `bun run start:worker` (or `pm2`, `systemd`, `docker`).

---

## 2. Environment

Copy ` .env.example:1` → `.env` (never commit `.env` — `.gitignore:69`).

| Var | Default | Notes |
|-----|---------|-------|
| `NODE_ENV` | `development` | `test` enables inline ingestion (no worker needed), `production` tightens logs |
| `LOG_LEVEL` | `info` | `debug` for processor `chunks_reused/reuse_rate` |
| `API_HOST/PORT` | `127.0.0.1:3000` | Fastify listen |
| `DATABASE_URL` | `postgresql://indexa:indexa@localhost:5432/indexa` | Must start with `postgresql://`; pgvector enabled via migration `packages/db/drizzle/0000_enable_pgvector.sql:1` |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ |
| `CHUNK_SIZE` | `512` | `1-8192`, <br/> `CHUNK_OVERLAP` must be `< CHUNK_SIZE` (`apps/api/src/config.ts:21`) |
| `CHUNK_OVERLAP` | `50` | `0-8191` |
| `VECTOR_DIMENSION` | `1536` | Must match `vector(1536)` column (`packages/db/src/schema.ts:1`); changing requires new migration |
| `DEFAULT_TOP_K` | `5` | `1-100` for `/search`/`/generate` defaults |
| `EMBEDDING_PROVIDER` | `fake` | `fake` → `FakeEmbeddingProvider` (`packages/embeddings/src/fake-provider.ts:1`), `openai` needs `EMBEDDING_MODEL`+`EMBEDDING_API_KEY` |
| `LLM_PROVIDER` | `fake` | `fake` → `FakeLLMProvider` (`packages/llm/src/fake-provider.ts:1`), `openai` needs `LLM_MODEL`+`LLM_API_KEY` |
| `WORKER_CONCURRENCY` | `2` | `apps/worker/src/worker.ts:1` |

Fail-fast: startup throws `ConfigurationError: Invalid API configuration -> ...` listing every bad var (`apps/api/src/config.ts:61`).

---

## 3. How to Load Data

### A) Curl (single document, sync in `NODE_ENV=test`, async otherwise)

```bash
# Markdown or TXT — contentType derived from filename if omitted
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"notes.md","content":"# Title\n\nBody text"}' | jq

# With explicit contentType
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"manual.txt","contentType":"text/plain","content":"plain text"}' | jq

# Response 201 (inline) or 202 (queued):
# {
#   "document": {"id":"...","filename":"notes.md","status":"pending","currentVersion":1},
#   "version": {"id":"...","version":1,"contentHash":"...","status":"pending"},
#   "ingestionJob": {"id":"...","status":"queued","attempts":0}
# }

# Poll job (at-least-once, `ingestion_jobs` is source of truth)
curl -s http://127.0.0.1:3000/jobs/<jobId> | jq
# queued → processing → completed | failed (with `error`)

# List / detail / chunks / delete
curl -s "http://127.0.0.1:3000/documents?limit=20&offset=0" | jq
curl -s http://127.0.0.1:3000/documents/<id> | jq
curl -s http://127.0.0.1:3000/documents/<id>/chunks | jq  # deterministic chunks, contentHash, tokenCount, embedding
curl -s -X DELETE http://127.0.0.1:3000/documents/<id>  # 204, cascades versions/chunks/jobs

# Update (incremental): creates version 2, re-embeds only changed chunks
curl -s -X POST http://127.0.0.1:3000/documents/<id>/reindex \
  -H 'content-type: application/json' \
  -d '{"content":"# Title\n\nUpdated body"}' | jq
# Same job polling as above; reuse rate logged by worker
```

### B) Bulk via script (ingest a folder)

```bash
for f in docs/*.md; do
  # escape JSON via jq --arg
  content=$(cat "$f")
  jq -n --arg fn "$(basename "$f")" --arg c "$content" \
    '{filename:$fn, content:$c}' \
  | xargs -I {} curl -s -X POST http://127.0.0.1:3000/documents \
      -H 'content-type: application/json' -d '{}' | jq '.ingestionJob.id'
done
# watch worker logs: bun run infra:logs | grep -i ingestion
```

### C) Evaluation dataset (seeds 5 docs + benchmarks retrieval)

```bash
bun run evaluate
# 1) reads evaluation/datasets/retrieval.json:1 (6 queries)
# 2) ensures evaluation/datasets/documents/*.md are ingested inline (no worker needed)
# 3) runs each query via SearchService (pgvector cosine, FakeEmbeddingProvider token-average)
# 4) computes Recall@K / Precision@K / MRR / nDCG@K + latency p50/p95
# 5) writes evaluation/benchmarks/<stamp>-k5-c512o50.json (git-ignored for lint, keep for experiments)

# Chunking experiment: compare two configs
CHUNK_SIZE=512 CHUNK_OVERLAP=50 bun run evaluate > /tmp/bench-512-50.json
CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate > /tmp/bench-256-32.json
jq .metrics /tmp/bench-*.json
# metrics: {recallAtK, precisionAtK, mrr, ndcgAtK, avgLatencyMs, p50LatencyMs, p95LatencyMs}
```

For ad-hoc incremental demo (100 chunks → 5 changed → only 5 embeddings):
```bash
bun apps/api/src/scripts/test_incremental.ts
bun apps/api/src/scripts/test_incremental_stale.ts
```

---

## 4. All Operations (API)

Base: `http://127.0.0.1:3000` (`API_HOST`/`API_PORT`). All bodies validated by Zod, errors map to `{statusCode, code, error}` (`apps/api/src/errors.ts:109`).

| Method | Path | Use | Request | Response |
|--------|------|-----|---------|----------|
| `GET` | `/health` | infra check | — | `200 {status:"ok", checks:{postgres,pgvector,redis}}` or `503` |
| `POST` | `/documents` | ingest | `Zod CreateDocumentSchema:1` `{filename, contentType?, content}` | `201 {document, version, ingestionJob}` (or `202` queued) |
| `GET` | `/documents?limit&offset` | list | `limit 1-100 default 20, offset >=0` | `{items, total, limit, offset}` newest first |
| `GET` | `/documents/:id` | detail | `uuid` | `{document, version: {content, metadata, contentHash}}` |
| `GET` | `/documents/:id/chunks` | chunks | `uuid` | `{documentId, chunks:[{chunkIndex, content, contentHash, tokenCount, embedding, metadata}]}` |
| `POST` | `/documents/:id/reindex` | new version (incremental) | `{content, filename?, contentType?}` | `201 {document, version:2, ingestionJob}` |
| `GET` | `/jobs/:id` | job status (source of truth) | `uuid` | `{id, status: queued|processing|completed|failed, attempts, error, createdAt}` |
| `DELETE` | `/documents/:id` | hard delete | `uuid` | `204` (cascades versions/chunks/jobs) |
| `POST` | `/search` | vector search | `SearchRequest:1` `{query, topK? 1-100 default 5, documentId?}` | `{query, results:[{chunkId, documentId, content, score (1=exact), metadata}]}` ordered cosine `1 - (embedding <=> query)` |
| `POST` | `/generate` | RAG | `GenerateRequest:1` `{query, topK?, systemPrompt?, documentId?}` | `{query, answer, citations:[{chunkId, documentId, content, score, metadata}], retrievedCount}` separate from `/search`, citations are proof of source |

Error codes: `VALIDATION_ERROR 400`, `DOCUMENT_NOT_FOUND 404`, `UNSUPPORTED_DOCUMENT_TYPE 415`, `DOCUMENT_PARSE_ERROR 422`, `CHUNKING_ERROR 422`, `EMBEDDING_PROVIDER_ERROR 502`, `LLM_PROVIDER_ERROR 502`, `RETRIEVAL_ERROR 500`.

**What you get:**
- Deterministic chunking (`packages/chunking/src/chunker.ts:42` sliding window, SHA-256 over normalized text `packages/chunking/src/hash.ts:1`, heading propagation)
- Incremental reuse: `previousByHash: contentHash→embedding` map outside transaction, only changed chunks embedded (`apps/api/src/services/document-service.ts:290`)
- Idempotency: unique `(document_id,version)`, `(document_version_id,chunk_index)`, `jobId=ingestionJobId` deduplication, `ON CONFLICT DO UPDATE excluded.*` (`apps/api/src/repositories/chunk-repository.ts:22`)
- At-least-once: BullMQ `attempts:5` exponential `delay:2000` (`apps/api/src/queue/ingestion-queue.ts:13`), `attempts/error/startedAt/completedAt` tracked
- Observability: structured logs with `document_id, document_version_id, ingestion_job_id, chunks_reused, chunks_reembedded, reuse_rate, latency`, never API keys
- Evaluation: Recall@K/MRR/nDCG/latency, versioned dataset (`evaluation/datasets/retrieval.json:1`), `bun run evaluate` is reproducible (Fake providers)
- Generation: isolated `EmbeddingProvider` (`packages/embeddings/src/provider.ts:6`) and `LLMProvider` (`packages/llm/src/provider.ts:6`), citations answer “which documents were used?”

---

## 5. Retrieval Evaluation (M9) — In Detail

Already benchmarked via `bun run evaluate` (see §3C). To run your own corpus:

1. Put markdowns in `evaluation/datasets/documents/`
2. Edit `evaluation/datasets/retrieval.json` to list `{id, question, query, expectedDocuments:[...]}`
3. `bun run evaluate -- --topK 5` or `CHUNK_SIZE=256 bun run evaluate`

Benchmarks are written to `evaluation/benchmarks/` (ignored by `biome.json:4` for lint). Compare via `jq .metrics evaluation/benchmarks/*.json`.

Metrics defined in `@indexa/evaluation` (`packages/evaluation/src/metrics.ts:1`): `recallAtK`, `precisionAtK`, `reciprocalRank` (MRR = mean), `ndcgAtK` (binary), aggregated across cases. Latency via `performance.now()` per query.

---

## 6. RAG Generation (M10)

```
POST /generate → SearchService (embed query → pgvector) → context [1]...[K] → LLMProvider.generate → answer + citations
```

- Provider: swap `LLM_PROVIDER=fake` (deterministic echo) ↔ `openai` (isolate SDK in `packages/llm/src/`). Never leak keys in logs.
- System prompt optional; default prompt is `Context:\n[1] ...\n\nQuestion: ...\n\nProvide an answer using only the context...Cite [n]`.
- No inventing sources: `citations` are the exact `SearchResult` used; generation never fabricates `chunkId`/`documentId`.
- Test similarly to search but assert `answer` contains `[` and `citations.length >=1` (`apps/api/tests/generation.test.ts:35`).

```bash
curl -s -X POST http://127.0.0.1:3000/generate \
  -H 'content-type: application/json' \
  -d '{"query":"How does chunking work?","topK":5}' | jq
# {"query":"...","answer":"Answer to ... based on 5 chunk(s)... Citations: [1], ...","citations":[{"chunkId":"...","documentId":"...","score":0.91,"metadata":{"heading":"Chunking"}}],"retrievedCount":5}
```

---

## 7. Developer Commands

```bash
bun install
bun run infra:up / infra:down / infra:logs
bun run db:generate      # after editing packages/db/src/schema.ts:1 → creates drizzle/000N_*.sql + meta
bun run db:migrate
bun run dev:api           # watch
bun run dev:worker        # watch, concurrency 2
bun run start:api / start:worker  # production (no watch)
bun run test              # 107 pass (skips integration if no DATABASE_URL/REDIS_URL)
bun run typecheck
bun run lint              # biome check
bun run format            # biome format --write
bun run evaluate          # retrieval quality; chunking experiments via CHUNK_SIZE env
```

`tsconfig.json:7` maps `@indexa/*` to `packages/*/src/index.ts`; `biome.json:22` disables non-null checks for `**/*.test.ts`.

---

## 8. Production Deploy Checklist

- [ ] Set `NODE_ENV=production`, `LOG_LEVEL=info` (or `warn`), `API_HOST=0.0.0.0`
- [ ] Provide real secrets: `DATABASE_URL` (managed Postgres with `pgvector` extension), `REDIS_URL` (TLS `rediss://` ok, `ioredis` retries `apps/api/src/app.ts:31`), `EMBEDDING_API_KEY`/`LLM_API_KEY` if not `fake`
- [ ] Keep `VECTOR_DIMENSION=1536` unless you migrate `vector(1536)` column (`packages/db/src/schema.ts:1: vector`)
- [ ] `CHUNK_SIZE`/`CHUNK_OVERLAP` chosen via benchmarks (`bun run evaluate` comparison); document choice
- [ ] Run `bun run db:migrate` exactly once on deploy (idempotent)
- [ ] Run `api` and `worker` as separate processes/containers; `WORKER_CONCURRENCY` ≈ CPU cores (2-4); BullMQ lock `30s` (`apps/worker/src/worker.ts:17`)
- [ ] Health probes: `GET /health` → 200 ok, else 503; alert on `failed` jobs (`SELECT count(*) FROM ingestion_jobs WHERE status='failed' AND created_at > now()-'1h'::interval`)
- [ ] Backups: `postgres-data` volume; `REDIS_URL` is queue only — `Postgres` is source of truth, Redis may be flushed
- [ ] Logs: ship Fastify JSON logs (pino) with `document_id, job_id, reuse_rate, latency`; never log `content` unless debug
- [ ] Frontend (optional `apps/web` Next.js): secondary, gated behind API reachability
- [ ] Security: do not expose `pgvector` port publicly; rate-limit `/documents` and `/generate`; validate `topK` bounds via Zod

Docker prod sketch:
```dockerfile
FROM oven/bun:1.3
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run db:migrate  # or run as init container
CMD ["bun","apps/api/src/server.ts"]
# plus second service: CMD ["bun","apps/worker/src/worker.ts"]
```

---

## 9. Troubleshooting

- `Invalid API configuration -> DATABASE_URL: must be ...` → check `.env` prefix (`postgresql://`), no quotes
- `migrate` says `relation already exists` → NOTICE is normal (repeatable `__drizzle_migrations`)
- `health` 503 `redis: false` → `docker compose ps`, `redis-cli ping`, check `REDIS_URL` port
- `embedding provider failure` → job `status=failed` with `error`, BullMQ retries with backoff; inspect `GET /jobs/:id` `attempts`
- `chunks not appearing` → check worker is running (`bun run infra:logs | grep ingestion`), or in `NODE_ENV=test` ingestion is inline (no worker needed) (`apps/api/src/app.ts:54`)
- `vector dimension mismatch` → `VECTOR_DIMENSION must be 1536` (`apps/api/src/config.ts:37`) — fix env or create migration `vector(768)` → `vector(1536)`
- `duplicate active chunks` → should not happen; relies on `chunks_version_index_uq` (`packages/db/src/schema.ts:68`) + `ON CONFLICT DO UPDATE` (`packages/db/drizzle/0002_tidy_mad_thinker.sql:16`); inspect `SELECT` for job

---

## 10. Quick Reference (copy-paste)

```bash
# Full reset (dev)
bun run infra:down -v && bun run infra:up && bun run db:migrate && bun test && bun run evaluate

# Chunk experiment
CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate  # -> evaluation/benchmarks/*

# Re-embed demo (should log reuse_rate ~0.95 for 5/100 changed)
bun apps/api/src/scripts/test_incremental.ts

# Generate after ingesting a doc
DOC=$(curl -s -X POST http://127.0.0.1:3000/documents -H 'content-type: application/json' -d '{"filename":"demo.md","content":"# Demo\n\nHello world"}' | jq -r .document.id)
curl -s -X POST http://127.0.0.1:3000/generate -H 'content-type: application/json' -d "{\"query\":\"Hello world\", \"documentId\":\"$DOC\", \"topK\":5}" | jq
```

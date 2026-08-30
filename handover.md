# Handover — Indexa

Last updated: 2026-08-30
Current milestone: **Milestone 8 — Reliability (complete)**
Previously completed: Milestone 7 — Async Processing, Milestone 6 — Incremental Indexing, Milestone 5 — Vector Search, Milestone 4 — Embeddings, Milestone 3 — Chunking
Spec: see `CLAUDE.md`

---

## 1. What was implemented

### Frontend console redesign

- Replaced the single-page dashboard with a routed Next.js App Router console for overview, documents, document details, playground, jobs, evaluation, and settings.
- Added a persistent responsive shell with collapsible sidebar, mobile navigation, breadcrumbs, service health, theme persistence via `next-themes`, and a restrained light/dark visual system.
- Added typed API error handling, URLSearchParams query encoding, request cancellation for document reads, upload validation, bounded sequential multi-file upload processing, ingestion polling cleanup, and visible empty/error/loading states.
- Added document detail chunk explorer with local search, expandable whitespace-preserving content, copy actions, reindex, and accessible deletion confirmation.
- Added retrieve/generate playground modes with document selection, URL state, keyboard shortcut, latency, ranked hits, grounded answer, and source links.
- Added `apps/web/src/lib/api.test.ts` and `validation.test.ts` for structured API errors and supported file validation.

### Frontend endpoint

- Added paginated `GET /jobs?limit=&offset=&status=` backed by the existing `ingestionJobs` table and repository. No other backend contracts were changed.

### Milestone 8 — Reliability (this change)

**Goal:** Make ingestion idempotent, retry-safe and concurrency-safe under BullMQ at-least-once execution.

- **Database (`packages/db`)** — migration `0003` (ingestion_jobs) + `0004` (vector column + unique):
  - `ingestion_jobs`: id, document_id FK cascade, document_version_id FK cascade (unique), status enum `queued|processing|completed|failed|cancelled`, attempts int, error text, created_at/started_at/completed_at, indexes on document/status.
  - `chunks.embedding vector(1536)` via Drizzle `customType` → `vector(1536)`; `VECTOR_DIMENSION=1536` validated at startup (mismatch requires migration).
  - Uniques retained: `(document_id,version)`, `(document_version_id,chunk_index)` for upsert idempotency.

- **Embeddings (`packages/embeddings`)**:
  - `EmbeddingProvider` interface (`embedDocuments`, `embedQuery`) isolates vendor SDKs.
  - `FakeEmbeddingProvider` deterministic FNV-based L2-normalized vectors, dimension-configurable, exposes `calls`, `totalChunksEmbedded`, `callsLog`, `resetCounts()` for reuse-rate tests.
  - `batch.ts` helpers `chunkArray` / `batchedEmbed` (batchSize 100 default).

- **Ingestion jobs (`apps/api`):**
  - `IngestionJobRepository` (`create` via `ON CONFLICT DO NOTHING` + SELECT, `findById/findByVersionId/listByDocument`, `claimForProcessing`/`markCompleted`/`markFailed`/`incrementAttempts`/`updateStatus`, `isTransientError` classifier).
  - `DocumentService` now async: `create`/`reindex` parse→hash→txn(document+version+job `queued`) → enqueue after commit; `processIngestionJob` loads job→doc→version, idempotent early-return if `completed`/`cancelled` or `version.ready`, transitions to `processing` (attempts++), chunks via `TokenChunker` outside txn, incremental embedding reuse (previous version `contentHash→embedding` map, embed only changed), `ON CONFLICT` upsert for chunks+embedding, txn for `ready`/`completed` or `failed`. No external calls inside long txn.
  - `IngestionQueue` (`apps/api/src/queue/ingestion-queue.ts`) — single `ingestion` BullMQ Queue, `DEFAULT_JOB_OPTIONS: {attempts:5, backoff:{type:'exponential', delay:2000}}`, `jobId=ingestionJobId` deduplication, `enqueueIngestionJob`.

- **Worker (`apps/worker`):**
  - `createIngestionProcessor` factory — same incremental reuse + upsert logic, `FakeEmbeddingProvider` fallback, structured logs (`chunks_reused/chunks_reembedded/reuse_rate`), at-least-once safe. `Worker` with `concurrency=WORKER_CONCURRENCY`, `lockDuration 30s`, `failed`/`error` handlers. Config now requires `DATABASE_URL` + validates `VECTOR_DIMENSION==1536`, `CHUNK_SIZE/OVERLAP`.
  - `IngestionJobPayload` `{ingestionJobId, documentId, documentVersionId}`.

- **API routes:**
  - `POST /documents` → 201 (inline completed) or 202 (queued) with `{jobId, job:{status,attempts}}`; `POST /documents/:id/reindex` (new version+job, enqueued), `GET /jobs/:id` (`ingestionJobs` source of truth, 404 if missing), `GET /documents/:id/chunks`, `POST /search` via `SearchService`/`SearchRepository` pgvector cosine search.

- **Reliability guarantees:**
  - Idempotency: same `documentVersionId` never duplicates jobs; same `(version,chunk_index)` never duplicates chunks; same BullMQ `jobId` never duplicates queue jobs; re-running `processIngestionJob` after `completed` is no-op.
  - Retries: transient (timeouts, rate limits, Redis/PG blips, embedding 502) → BullMQ backoff; permanent (parse/unsupported/chunk) → fail fast, recorded `error`, not retried endlessly; `attempts`, `startedAt`, `completedAt` tracked.
  - Concurrency: unique constraints + upserts + short txns protect concurrent workers racing on same version/job; tests use `Promise.allSettled` dual processing.

### Prior milestones (7 → 3)
- M7 async: BullMQ + Redis queue, `processInline` for tests, `GET /jobs/:id` polling.
- M6 incremental: content-hash reuse, `embedding_reuse_rate` metric, re-embed only changed.
- M5 vector search: `POST /search` cosine similarity via pgvector, `SearchService`/`SearchRepository`.
- M4 embeddings: provider abstraction + batching, `FakeEmbeddingProvider`.
- M3 chunking: `TokenChunker` deterministic sliding window, `chunk_size`/`chunk_overlap` configurable, SHA-256 `contentHash`, heading propagation.

## 2. Files created / changed (Milestone 8)

```
packages/db/src/schema.ts                      ingestion_jobs + vector(1536), customType
packages/db/src/index.ts                       re-exports
packages/db/drizzle/0003_*.sql / 0004_*.sql    generated migrations
packages/embeddings/*                          provider interface, FakeProvider, batch helpers, tests
apps/api/src/queue/ingestion-queue.ts          Queue + DEFAULT_JOB_OPTIONS + enqueue
apps/api/src/repositories/ingestion-job-repository.ts
apps/api/src/repositories/chunk-repository.ts  + embedding upsert
apps/api/src/repositories/search-repository.ts
apps/api/src/services/document-service.ts      async create/reindex/processIngestionJob + reuse
apps/api/src/services/search-service.ts
apps/api/src/routes/documents.ts               POST reindex, job fields
apps/api/src/routes/jobs.ts / search.ts
apps/api/src/schemas/document-schemas.ts       reindex schema
apps/api/src/config.ts                         VECTOR_DIMENSION etc
apps/api/src/app.ts                            FakeEmbeddingProvider wiring, queue, searchRoutes
apps/worker/src/config.ts                      DATABASE_URL + CHUNK/vector validation
apps/worker/src/processors/ingestion.ts        createIngestionProcessor factory
apps/worker/src/worker.ts                      Worker with embedding provider
apps/api/tests/reliability.test.ts             idempotency / concurrency / retry / job API / queue config
apps/api/tests/m7-async.test.ts / search.test.ts / incremental.test.ts
biome.json / tsconfig.json                      test overrides + @indexa/* paths
```

## 3. How to run

```bash
bun install
bun run infra:up      # docker compose up -d --wait (postgres+pgvector, redis)
cp .env.example .env
bun run db:migrate    # applies 0000-0004
bun run dev:api       # http://127.0.0.1:3000 (test env: processInline=true)
bun run dev:worker    # BullMQ ingestion worker (concurrency 2)

curl -s -X POST http://127.0.0.1:3000/documents -H 'content-type: application/json' \
  -d '{"filename":"notes.md","content":"# Title\n\nBody"}' | jq
curl -s http://127.0.0.1:3000/jobs/<jobId> | jq
curl -s -X POST http://127.0.0.1:3000/documents/<id>/reindex -H 'content-type: application/json' \
  -d '{"content":"# Updated\n\nNew body"}' | jq
curl -s -X POST http://127.0.0.1:3000/search -H 'content-type: application/json' \
  -d '{"query":"how does indexing work?","topK":5}' | jq
```

## 4. Verification performed (all passing)

| Check | Result |
| --- | --- |
| `bun run db:generate` / `bun run db:migrate` | generated 0003/0004, applied clean |
| `bun test` | **85 pass / 0 fail** (includes 6 reliability, 3 m7-async, 3 search, plus prior suites) |
| `bun run typecheck` | clean |
| `bun run lint` | clean (Biome) |
| Worker starts | `WORKER_CONCURRENCY` validated, Redis/Postgres required |
| Idempotency test | same `ingestionJobId` twice → no duplicate chunks (unique constraint) |
| Concurrency test | `Promise.allSettled` dual workers → `Set(chunkIndex).size == length` |
| Retry test | flaky provider timeout→ `failed`→ reset to `queued`→ second process `completed`, metrics `reuse_rate` |
| Job API | `GET /jobs/:id` polling, `reindex` creates version 2 with new job |

### Frontend verification (2026-08-30)

| Check | Result |
| --- | --- |
| `bun install` / frontend dependencies | pass |
| `bun run lint` | pass |
| `bun run typecheck` | pass |
| `bun --cwd apps/web next build` | pass; 9 routes generated |
| `bun test` | blocked by unavailable local PostgreSQL/Redis; existing integration tests report `ECONNREFUSED` |

The frontend build was compiled and type-checked successfully. Browser visual inspection was not automated in this environment; the layout uses responsive desktop/mobile breakpoints and no API data is fabricated.

### Follow-up visual fix

- Fixed the root shell wrapper to use a horizontal flex layout so the sidebar and content stay side-by-side and the top bar retains its intended compact height.
- Re-ran frontend lint, typecheck, and production build after the fix; all passed.
- Fixed development-mode request cancellation handling: browser abort variants such as `signal is aborted without reason` are now ignored during Strict Mode effect cleanup instead of being rendered as document request failures. Added regression coverage.
- Fixed async upload/reindex flows to use bounded, cancellable job polling with timeout feedback; document deletion now has handled success/failure feedback; desktop sidebar is sticky.
- Fixed bodyless `DELETE /documents/:id` requests by omitting `content-type: application/json` when no request body is present; added a regression test for this client contract.
- Fixed playground result rendering when switching modes or receiving an incomplete response; retrieval now safely handles absent `results` and generation uses the real response shape. Added server-side OpenAI embedding and chat providers selected by `EMBEDDING_PROVIDER=openai` / `LLM_PROVIDER=openai`, with required-key validation and no browser exposure of secrets.
- Added settings-tab AI configuration: `GET/PUT /settings/ai` applies provider/model/API-key changes to the running API process, returns only masked/configured state, and the settings page uses password inputs with write-only key fields. The deterministic provider remains available as an explicit local fallback.
- Added Gemini embedding/generation providers, Anthropic generation provider, and OpenAI-compatible endpoint support for gateway providers such as OpenRouter, Groq, and Together. Provider calls use the documented native HTTP APIs; Anthropic is correctly unavailable in the embedding selector.
- Fixed the overview (`/`) upload action by mounting the shared upload dialog; completed uploads now refresh overview data and the existing bounded job polling flow is used.

## 5. Known issues / notes

- None blocking. `VECTOR_DIMENSION` locked to 1536 to match `vector(1536)` column; changing requires new migration.
- `updated_at` trigger still deferred.
- Large-content streaming/object storage deferred.
- PDF not yet supported (Markdown/TXT only).
- Embedding reuse measured via `chunksReused/chunksReembedded/reuse_rate` logs and `FakeEmbeddingProvider` counters; `/metrics` endpoint deferred.

## 6. Recommended next milestone

**Milestone 9 — Retrieval Evaluation**: `evaluation/datasets/retrieval.json`, `Recall@K`/`MRR`/`nDCG` runner `bun run evaluate`, chunking experiments `chunk_size=256/512` comparisons, latency metrics. Generation (`POST /generate` with citations) after retrieval validated.

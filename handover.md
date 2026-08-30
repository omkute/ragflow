# Indexa — Handover

Last updated: 2026-08-30

## Current state

Indexa is a working local/self-hosted RAG indexing console. The backend
supports versioned Markdown and text ingestion, deterministic chunking,
incremental embedding reuse, BullMQ processing, PostgreSQL/pgvector retrieval,
grounded generation, and retrieval evaluation. The frontend exposes those
operations through a routed Next.js console.

The root [`README.md`](README.md) is the public project guide. This document
records implementation status, operational notes, and known limitations.

## Implemented features

### Backend and worker

- Fastify API with Zod validation and structured errors.
- PostgreSQL schema for documents, versions, chunks, embeddings, and ingestion
  jobs, managed through Drizzle migrations.
- Deterministic normalization, SHA-256 hashing, and token-aware chunking.
- Incremental indexing that reuses embeddings for unchanged chunk hashes.
- BullMQ/Redis ingestion with bounded retries and exponential backoff.
- Idempotent job creation and chunk upserts protected by database uniqueness
  constraints.
- Job lifecycle persistence with attempts, timestamps, and failure details.
- pgvector cosine similarity search through `POST /search`.
- Grounded generation through `POST /generate`, including citations.
- Runtime provider configuration through `GET/PUT /settings/ai`.
- Provider adapters for deterministic local testing, OpenAI, Google Gemini,
  Anthropic generation, and OpenAI-compatible endpoints.
- Paginated `GET /jobs` for the web console.

### Frontend console

- Persistent responsive shell with sidebar, breadcrumbs, health indicator, and
  light/dark/system theme support.
- Overview with pipeline state, service health, recent documents, and upload.
- Documents table with search, status filtering, pagination, upload progress,
  ingestion polling, retry feedback, and accessible deletion confirmation.
- Document detail route with metadata, version state, content, chunk explorer,
  local chunk search, copy actions, reindex, and delete.
- Playground with Retrieve and Generate modes, URL state, document selection,
  top-K controls, latency, ranked chunks, grounded answers, and citations.
- Jobs list/detail routes with lifecycle state and failure information.
- Evaluation and Settings routes that distinguish available data from future
  or unavailable metrics.
- Typed API client with cancellation-aware requests and a structured `ApiError`.

## Important operational notes

Start infrastructure first, then run the API, worker, and web app in separate
terminals:

```bash
bun install
cp .env.example .env
bun run infra:up
bun run db:migrate
bun run dev:api       # http://127.0.0.1:3000
bun run dev:worker
bun run dev:web       # http://127.0.0.1:3001
```

The web app uses `NEXT_PUBLIC_API_URL`, defaulting to
`http://127.0.0.1:3000`. Runtime AI settings entered in the web UI are stored
only in API process memory and reset on API restart. The worker is a separate
process; real embedding configuration must also be available to the worker for
asynchronous ingestion.

The current database vector type is `vector(1536)`. Changing the embedding
dimension requires a new migration and coordinated provider configuration.

## Evaluation

The evaluation runner is available through:

```bash
bun run evaluate
bun run evaluate -- --topK 10
CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate
```

It uses `evaluation/datasets/retrieval.json`, ingests missing benchmark
documents inline, runs pgvector retrieval, and writes timestamped JSON results
under `evaluation/benchmarks/`. Implemented metrics include Recall@K,
Precision@K, MRR, nDCG@K, latency percentiles, and embedding counts.

## Verification

The following checks passed during the latest frontend/API verification:

| Check | Result |
| --- | --- |
| `bun run lint` | Passed |
| `bun run typecheck` | Passed |
| `bun --cwd apps/web next build` | Passed; 9 routes generated |
| `bun test apps/web/src/lib/api.test.ts apps/web/src/lib/validation.test.ts` | Passed; 6 tests, 0 failures |
| Full repository test suite | Previously passed; integration coverage requires local PostgreSQL/Redis |

Browser visual inspection was performed during frontend iteration. Automated
browser tests are not currently part of the repository.

## Known limitations

- Only Markdown and plain text are supported; PDF ingestion is not implemented.
- Runtime AI settings are in-memory and reset when the API restarts.
- The worker does not automatically receive API-process runtime settings.
- Embedding reuse is counted in ingestion metrics/logging but is not persisted
  as historical dashboard telemetry.
- The vector schema is fixed at 1536 dimensions.
- Large-content streaming and object storage are not implemented.

## Next sensible improvements

1. Persist safe operational metrics for embedding reuse and ingestion history.
2. Add a small mocked Playwright smoke suite for the main document-to-playground
   flow.
3. Add durable, encrypted provider settings if multi-process persistence is
   required.
4. Extend document processing beyond Markdown and plain text only when there is
   a concrete product requirement.

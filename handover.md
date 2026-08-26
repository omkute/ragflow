# Handover — Indexa

Last updated: 2026-08-26
Current milestone: **Milestone 1 — Foundation (complete)**
Spec: see `CLAUDE.md`

---

## 1. What was implemented

Milestone 1 only. Bun + TypeScript monorepo with Bun workspaces:

- **`apps/api`** — Fastify + Zod HTTP API.
  - `GET /health`: parallel readiness checks for PostgreSQL (`SELECT 1`),
    pgvector (extension installed), and Redis (`PING`). Each check has a 2s
    deadline; `200 {status:"ok"}` when all pass, `503 {status:"degraded"}`
    otherwise, with per-check latency and error detail. No stack traces or
    internals leak on errors.
  - Typed env configuration via Zod (`loadConfig`); startup fails fast and
    clearly listing every invalid/missing variable.
  - Explicit error handling: `AppError` base mapped by a global error handler;
    4xx passthrough, 5xx logged server-side and returned as generic
    `Internal Server Error`.
  - Structured logging via Fastify's built-in pino (`service`, `env` base fields).
  - Graceful shutdown on SIGINT/SIGTERM; connections cleaned up in `onClose`.

- **`apps/worker`** — BullMQ worker bound to the single `ingestion` queue.
  - Starts, connects to Redis, consumes with configurable concurrency.
  - Ingestion processor is an explicit stub that throws (real processing is
    Milestone 7) so no job can silently "succeed".
  - Same fail-fast Zod config pattern; graceful shutdown.

- **`packages/db`** — Drizzle ORM + postgres.js client, shared pgvector helpers
  (`isPgVectorInstalled`, `assertPgVector`), migration runner.
  - Initial migration `0000_enable_pgvector.sql`: `CREATE EXTENSION IF NOT EXISTS vector;`
  - Schema file intentionally empty until Milestone 2 adds domain tables.

- **Infrastructure** — `docker-compose.yml` with `pgvector/pgvector:pg16`
  (port 5432) and `redis:7-alpine` (port 6379), healthchecks, named volumes.

- **Tooling** — root scripts (`dev:api`, `dev:worker`, `test`, `typecheck`,
  `lint`, `format`, `db:migrate`, `db:generate`, `infra:*`), Biome lint/format,
  strict TypeScript, `.env.example` (`.env` gitignored).

## 2. Files created / changed

```
package.json                     root workspace + scripts
tsconfig.base.json, tsconfig.json
biome.json
.env.example                     (committed template; local .env not committed)
docker-compose.yml
bun.lock
README.md                        rewritten: overview, quickstart, commands
apps/api/package.json, tsconfig.json
apps/api/src/{server,app,config,errors}.ts
apps/api/src/routes/health.ts
apps/api/tests/{config,health.test}.ts
apps/worker/package.json, tsconfig.json
apps/worker/src/worker.ts, config.ts
apps/worker/src/jobs/{queues,connection}.ts
apps/worker/src/processors/ingestion.ts
apps/worker/tests/config.test.ts
packages/db/package.json, tsconfig.json, drizzle.config.ts
packages/db/src/{index,client,schema,pgvector,migrate}.ts
packages/db/tests/pgvector.test.ts
packages/db/drizzle/0000_enable_pgvector.sql
packages/db/drizzle/meta/_journal.json
```

## 3. How to run

```bash
bun install
bun run infra:up      # docker compose up -d --wait
cp .env.example .env
bun run db:migrate    # applies drizzle migrations (enables pgvector)
bun run dev:api       # http://127.0.0.1:3000
bun run dev:worker
curl -s http://127.0.0.1:3000/health
```

## 4. Verification performed (all passing)

| Check | Result |
| --- | --- |
| `bun install` | OK (Bun 1.3.14) |
| `docker compose up -d --wait` | postgres healthy, redis healthy |
| `bun run db:migrate` | applied; `vector 0.8.6` present in `pg_extension` |
| API start + `GET /health` | `200 {"status":"ok", checks all ok}` |
| Degraded path (Redis stopped) | `503 {"status":"degraded"}`, redis check times out at ~2s without hanging the endpoint |
| Worker start | connects to Redis, logs `Worker started` for `ingestion` queue |
| `bun test` | 14 pass, 0 fail (incl. live PG/pgvector/Redis integration tests) |
| `bun run typecheck` | clean |
| `bun run lint` (Biome) | clean |

## 5. Known issues / notes

- None blocking.
- Integration tests skip (with message) when `DATABASE_URL`/`REDIS_URL` are
  unset; they were verified against live infrastructure here.
- `db:migrate` must run from repo root (script does this) so Bun loads `.env`.
- The ingestion processor deliberately throws if a job arrives — replace in
  Milestone 7.
- Nothing has been committed to git yet (working tree contains all changes);
  the user committed `CLAUDE.md` separately mid-session.
- No "Handover Documentation Protocol" was found in the repo; this file
  follows the reporting structure requested for Milestone 1.

## 6. Recommended next milestone

**Milestone 2 — Document Ingestion**: document/document_version models +
Drizzle schema tables, `POST /documents` upload endpoint (thin route →
service), Markdown/TXT parsers behind the `DocumentParser` interface,
persistence and document status. This builds directly on the empty
`packages/db/src/schema.ts` and the config/service patterns established here.

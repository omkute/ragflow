# Indexa

Incremental RAG indexing & retrieval infrastructure.

Indexa ingests documents, chunks them deterministically, embeds them into PostgreSQL
(pgvector), and — its defining feature — **reuses embeddings for unchanged chunks**
when documents change, re-embedding only what actually differs.

> Status: **Milestone 2 — Document Ingestion** complete (M1 foundation before
> that). See `CLAUDE.md` for the full spec and roadmap, `handover.md` for
> current state.

## Stack

| Concern     | Technology                          |
| ----------- | ----------------------------------- |
| Runtime     | Bun + TypeScript                    |
| API         | Fastify + Zod                       |
| Async jobs  | BullMQ + Redis                      |
| Database    | PostgreSQL + pgvector + Drizzle ORM |
| Infra       | Docker Compose                      |
| Tests/Lint  | `bun test`, Biome                   |

## Layout

```
apps/
  api/       Fastify HTTP API (health + document ingestion)
  worker/    BullMQ ingestion worker (queue wired; processing arrives in M7)
packages/
  db/        Drizzle client, schema, migrations, pgvector helpers
  document-processing/  parsers, normalization, content hashing
```

## Documents API

```bash
# Upload a Markdown/TXT document (contentType optional; derived from extension)
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"notes.md","content":"# Title\n\nBody text"}'

curl -s http://127.0.0.1:3000/documents            # list
curl -s http://127.0.0.1:3000/documents/<id>       # detail incl. normalized content
curl -s -X DELETE http://127.0.0.1:3000/documents/<id>
```

Upload flow: validate (Zod) → parse via format-specific parser → normalize →
SHA-256 content hash → persist `documents` + `document_versions` atomically.
Unsupported types return `415`, invalid payloads `400`, unknown ids `404`.

## Getting started

```bash
bun install                 # install dependencies
docker compose up -d --wait # start PostgreSQL (+pgvector) and Redis
cp .env.example .env        # configure environment

bun run db:migrate          # apply migrations (enables pgvector)
bun run dev:api             # http://127.0.0.1:3000
bun run dev:worker          # starts ingestion worker
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

Returns `200` with per-dependency checks (`postgres`, `pgvector`, `redis`),
or `503` with `status: "degraded"` when any dependency is unreachable.

## Testing notes

Integration tests require running infrastructure (`DATABASE_URL` / `REDIS_URL`
set, e.g. via `.env`); they skip with an explanatory message when the
environment variables are absent.

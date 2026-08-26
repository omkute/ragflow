# Handover — Indexa

Last updated: 2026-08-26
Current milestone: **Milestone 2 — Document Ingestion (complete)**
Previously completed: Milestone 1 — Foundation
Spec: see `CLAUDE.md`

---

## 1. What was implemented

### Milestone 2 — Document Ingestion (this change)

- **`packages/document-processing`** (new shared package — will be reused by
  the worker in M7):
  - `DocumentParser` interface (`supports`, `parse(Buffer) → ParsedDocument`)
    exactly per spec.
  - `MarkdownParser` (extracts first H1 as `title` metadata) and
    `TextParser`; registry with `selectParser` /
    `contentTypeFromFilename` (`.md`, `.markdown`, `.txt`).
  - Deterministic `normalizeText`: UTF-8 decode, CRLF/CR → LF, BOM +
    zero-width stripping, 3+ blank lines collapsed to one, outer trim.
    Intra-line whitespace intentionally preserved (code blocks).
  - `contentHash` = lowercase SHA-256 hex over **normalized** text.
    Hashing strategy: hash what normalization produces, never raw bytes.

- **Schema + migration** (`packages/db`):
  - `documents`: id, source, filename, content_type, current_version,
    status (`document_status` enum: pending/processing/ready/failed),
    created_at, updated_at; index on status.
  - `document_versions`: id, document_id (FK cascade), version,
    content_hash, status, content (normalized text), metadata (jsonb),
    created_at, completed_at; **unique index on (document_id, version)**.
  - Migration `0001_*` generated via drizzle-kit and applied live.

- **API** (`apps/api`):
  - `POST /documents` — thin route → Zod validation → `DocumentService.create`:
    resolve content type (explicit or from extension; unsupported → **415**)
    → parse → normalize → hash → atomic transaction insert of document +
    version v1 → **201** with summary (no content echo).
  - `GET /documents` — validated pagination (`limit` 1–100 default 20,
    `offset` ≥ 0), newest first, includes total count.
  - `GET /documents/:id` — detail incl. normalized content + metadata.
  - `DELETE /documents/:id` — hard delete, versions cascade, **204**;
    unknown/malformed ids → **404** / **400**.
  - New domain errors: `BadRequestError`, `DocumentNotFoundError`,
    `UnsupportedDocumentTypeError`, `DocumentParseError` — all mapped by the
    existing AppError handler without leaking internals.
  - Layering kept: routes (thin) → service (orchestration) → repository
    (Drizzle access); parsing isolated in the package; short DB transaction
    only around the two-row insert (no external calls inside).

- Status semantics note: M2 ingests synchronously and marks document/version
  `ready` once content is durably stored. The queued→processing→…→ready
  transitions arrive with the M7 worker pipeline.

### Milestone 1 — Foundation (previous)

Bun workspaces monorepo; Fastify API with `/health` (Postgres/pgvector/Redis
checks with 2s deadlines, 200 ok / 503 degraded); BullMQ worker bound to the
single `ingestion` queue with loud stub processor; Drizzle client + initial
pgvector migration; Docker Compose infra; Biome; fail-fast Zod env config.

## 2. Files created / changed (Milestone 2)

```
packages/document-processing/package.json, tsconfig.json
packages/document-processing/src/{index,types,normalize,hash}.ts
packages/document-processing/src/{markdown-parser,text-parser,registry}.ts
packages/document-processing/tests/{normalize,hash,parsers,registry}.test.ts
packages/db/src/schema.ts                    documents + document_versions tables
packages/db/src/index.ts                     schema re-exports
packages/db/drizzle.config.ts                cwd-independent paths
packages/db/drizzle/0001_*.sql               generated migration (+ journal)
apps/api/package.json                        + drizzle-orm, @indexa/document-processing
apps/api/src/errors.ts                       BadRequest/NotFound/UnsupportedType/Parse errors, parseWith()
apps/api/src/schemas/document-schemas.ts     request validation schemas
apps/api/src/repositories/document-repository.ts
apps/api/src/services/document-service.ts
apps/api/src/routes/documents.ts             POST/GET list/GET detail/DELETE
apps/api/src/app.ts                          route wiring
apps/api/tests/documents.test.ts             unit + integration tests
README.md                                    documents API docs, layout, status
handover.md                                  this file
```

## 3. How to run

```bash
bun install
bun run infra:up      # docker compose up -d --wait
cp .env.example .env
bun run db:migrate    # applies both migrations
bun run dev:api       # http://127.0.0.1:3000
curl -s -X POST http://127.0.0.1:3000/documents \
  -H 'content-type: application/json' \
  -d '{"filename":"notes.md","content":"# Title\n\nBody"}'
```

## 4. Verification performed (all passing)

| Check | Result |
| --- | --- |
| `bun run db:generate` | generated migration from schema |
| `bun run db:migrate` | applied; `\dt` shows documents + document_versions |
| `bun test` | **45 pass / 0 fail** (22 document-processing, 7 documents API incl. live roundtrip, plus prior suite) |
| `bun run typecheck` | clean |
| `bun run lint` | clean |
| Live curl roundtrip | upload markdown → 201 (hash, title metadata) → GET detail shows normalized content → list → 415 on unsupported type → DELETE 204 → GET 404 |

## 5. Known issues / notes

- None blocking.
- `updated_at` is set on insert only (no trigger yet); relevant once updates
  exist (M6 reindexing).
- Content is stored per version row; large-content handling (streaming,
  object storage) deferred until needed.
- PDF support is explicitly out of scope until a later milestone.
- Nothing committed to git yet for Milestone 2 (user commits separately).

## 6. Recommended next milestone

**Milestone 3 — Chunking**: deterministic token-aware chunker in a
`packages/chunking` package (configurable chunk_size/chunk_overlap), chunk
persistence referencing `document_versions.id`, SHA-256 chunk hashes, heading
metadata propagation, unit tests for determinism and boundaries. The
normalized content now stored in `document_versions.content` is the direct
input.

# Indexa

## Incremental RAG Indexing & Retrieval Infrastructure

## Project Overview

Build **Indexa**, a production-style RAG indexing and retrieval system focused on reliable document ingestion, incremental indexing, asynchronous processing, and measurable retrieval quality.

The core pipeline is:

```text
Document
   ↓
Ingestion
   ↓
Parsing / Normalization
   ↓
Chunking
   ↓
Content Hashing
   ↓
Change Detection
   ↓
Embedding
   ↓
Vector Indexing
   ↓
Retrieval
   ↓
Optional LLM Generation
```

The defining feature is **incremental indexing**.

When a document changes, Indexa must identify which chunks are unchanged and reuse their existing embeddings instead of re-embedding the entire document.

The project should demonstrate strong:

* TypeScript backend engineering
* Applied AI infrastructure
* asynchronous processing
* database design
* vector search
* reliability engineering
* retrieval evaluation

This is **not** intended to be a simple "chat with PDF" application.

---

# Primary Goals

* Build a reliable document ingestion pipeline.
* Support Markdown, TXT, and PDF initially.
* Normalize documents into a common internal representation.
* Implement deterministic chunking.
* Generate embeddings for chunks.
* Store vectors in PostgreSQL using pgvector.
* Detect document changes using content hashes.
* Reuse embeddings for unchanged chunks.
* Re-embed only new/changed chunks.
* Remove stale chunks from the active index.
* Process ingestion asynchronously.
* Make ingestion jobs idempotent.
* Support retries and failure handling.
* Expose a retrieval API.
* Measure retrieval quality.
* Track ingestion and retrieval metrics.
* Keep core business logic independent from external AI providers.

---

# Non-Goals

Do not add unnecessary complexity.

Do NOT implement unless explicitly required:

* Autonomous agents
* Multi-agent systems
* Knowledge graphs
* Graph RAG
* Multimodal RAG
* Fine-tuning
* Model training
* Kubernetes
* Service mesh
* Microservices for the sake of microservices
* Multiple vector databases
* Complex authentication
* Complex billing
* Large-scale frontend features

The project should remain focused on:

> **Incremental RAG indexing + reliable retrieval infrastructure**

---

# Technology Stack

## Runtime

Use:

* Bun
* TypeScript

Bun should be used for local development, scripts, package management, and application execution unless a dependency requires Node.js compatibility.

Do not introduce another runtime without a clear reason.

---

## API

Use:

* Fastify
* TypeScript
* Zod

Fastify should handle HTTP concerns.

Business logic should live in services/domain modules rather than directly inside route handlers.

---

## Worker

Use:

* TypeScript
* BullMQ
* Redis

Workers are responsible for asynchronous ingestion and indexing jobs.

---

## Database

Use:

* PostgreSQL
* pgvector
* Drizzle ORM

PostgreSQL is the source of truth for:

* documents
* document versions
* chunks
* ingestion jobs
* metadata
* embeddings

Do not introduce a separate vector database initially.

---

## Frontend

Optional.

If implemented:

* Next.js
* TypeScript
* Tailwind CSS

The frontend is secondary to the backend and indexing system.

Do not spend significant development time polishing UI before the pipeline is reliable.

---

## AI Providers

Use provider abstractions.

The application must not depend directly on a specific embedding or LLM provider throughout the codebase.

Example:

```ts
interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
```

Example:

```ts
interface LLMProvider {
  generate(input: {
    system?: string;
    prompt: string;
  }): Promise<string>;
}
```

Provider-specific SDK code should be isolated.

---

# Repository Structure

Prefer:

```text
indexa/
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── services/
│   │   │   ├── repositories/
│   │   │   ├── schemas/
│   │   │   ├── domain/
│   │   │   ├── config/
│   │   │   └── server.ts
│   │   └── tests/
│   │
│   ├── worker/
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   ├── processors/
│   │   │   ├── services/
│   │   │   └── worker.ts
│   │   └── tests/
│   │
│   └── web/
│       └── ...
│
├── packages/
│   ├── db/
│   ├── embeddings/
│   ├── chunking/
│   ├── document-processing/
│   ├── config/
│   └── shared/
│
├── evaluation/
│   ├── datasets/
│   ├── benchmarks/
│   └── scripts/
│
├── scripts/
│
├── docker-compose.yml
├── .env.example
├── package.json
├── bun.lock
└── README.md
```

Do not create packages simply for organizational aesthetics.

Extract a package only when there is a meaningful boundary or reusable functionality.

---

# Architectural Principles

## Separation of Concerns

Keep these responsibilities separate:

```text
Parsing
   ↓
Normalization
   ↓
Chunking
   ↓
Hashing
   ↓
Change Detection
   ↓
Embedding
   ↓
Indexing
   ↓
Retrieval
   ↓
Generation
```

A parser must not know how vectors are stored.

A chunker must not call an embedding API.

An embedding provider must not know about PostgreSQL.

A route handler must not contain the complete ingestion algorithm.

---

# Domain Model

## Document

Represents the logical source document.

Minimum fields:

```text
id
source
filename
content_type
current_version
status
created_at
updated_at
```

Possible statuses:

```text
pending
processing
ready
failed
```

---

## DocumentVersion

Represents one indexed version of a document.

Fields:

```text
id
document_id
version
content_hash
status
created_at
completed_at
```

Example:

```text
Document
  │
  ├── Version 1
  ├── Version 2
  └── Version 3
```

A document update should create a new version rather than silently overwriting indexing history.

---

## Chunk

Represents an individual searchable section.

Minimum fields:

```text
id
document_id
document_version_id
chunk_index
content
content_hash
token_count
embedding
metadata
created_at
updated_at
```

Metadata may contain:

```text
source
filename
page_number
section
heading
```

Only include metadata that is actually useful.

---

## IngestionJob

Represents asynchronous processing.

Fields:

```text
id
document_id
document_version_id
status
attempts
error
created_at
started_at
completed_at
```

States:

```text
queued
processing
completed
failed
cancelled
```

---

# Document Lifecycle

The expected lifecycle:

```text
uploaded
   ↓
queued
   ↓
processing
   ↓
parsed
   ↓
chunked
   ↓
embedding
   ↓
indexed
   ↓
ready
```

On unrecoverable failure:

```text
processing
   ↓
failed
```

The system must retain enough information to diagnose the failure.

---

# Document Ingestion

Initially support:

* Markdown
* TXT
* PDF

Do not implement every possible format.

Each format should have a parser behind a common interface.

Example:

```ts
interface DocumentParser {
  supports(contentType: string): boolean;

  parse(input: Buffer): Promise<ParsedDocument>;
}
```

Normalized output:

```ts
interface ParsedDocument {
  text: string;
  metadata: Record<string, unknown>;
}
```

Parsing must be independent from chunking and embedding.

---

# Chunking

The chunker must be deterministic.

Given:

```text
same input
+
same configuration
```

the output must be the same.

Configuration should include:

```text
chunk_size
chunk_overlap
```

Prefer token-aware chunking.

Do not use arbitrary string slicing if it causes poor retrieval boundaries.

Interface:

```ts
interface Chunker {
  chunk(
    document: ParsedDocument
  ): Promise<Chunk[]>;
}
```

Chunking should preserve useful metadata such as:

* source
* section
* page number
* heading

when available.

---

# Content Hashing

Every normalized chunk must have a deterministic content hash.

Use:

```text
SHA-256(normalized chunk content)
```

Example:

```ts
const contentHash = sha256(normalizedContent);
```

The hash is used to determine whether a chunk can reuse an existing embedding.

Do not hash raw formatting if normalization removes that formatting.

The hashing strategy must be documented.

---

# Incremental Indexing

This is the **core feature of Indexa**.

When a document is updated:

```text
New document
     ↓
Parse
     ↓
Normalize
     ↓
Chunk
     ↓
Hash chunks
     ↓
Compare against previous version
```

For unchanged chunks:

```text
same content_hash
      ↓
reuse embedding
```

For new/changed chunks:

```text
different content_hash
      ↓
generate embedding
      ↓
store/upsert vector
```

For deleted chunks:

```text
chunk existed previously
but not in new version
      ↓
remove/deactivate from active index
```

---

# Incremental Indexing Example

Version 1:

```text
chunk A → hash A
chunk B → hash B
chunk C → hash C
chunk D → hash D
```

Version 2:

```text
chunk A → hash A
chunk B → hash X
chunk C → hash C
chunk D → hash Y
```

Expected behavior:

```text
A → reuse embedding
B → re-embed
C → reuse embedding
D → re-embed
```

Embedding operations:

```text
2
```

not:

```text
4
```

For a 100,000-chunk corpus, this distinction can become substantial.

---

# Incremental Indexing Algorithm

Conceptually:

```ts
const previousChunks =
  await chunkRepository.findActiveByDocument(documentId);

const previousByHash = new Map(
  previousChunks.map(chunk => [
    chunk.contentHash,
    chunk
  ])
);

for (const newChunk of newChunks) {
  const existing = previousByHash.get(
    newChunk.contentHash
  );

  if (existing) {
    await reuseExistingEmbedding(existing, newChunk);
  } else {
    const embedding =
      await embeddingProvider.embedDocuments([
        newChunk.content
      ]);

    await indexNewChunk({
      chunk: newChunk,
      embedding: embedding[0],
    });
  }
}
```

The actual implementation may use a more sophisticated identity strategy.

The observable behavior must remain:

> unchanged content must not require a new embedding.

---

# Chunk Identity

Do not rely exclusively on database-generated UUIDs to determine whether a chunk is unchanged.

Use deterministic information such as:

```text
document_id
content_hash
```

or an equivalent logical identity.

Database IDs represent storage identity.

Content hashes represent content identity.

Keep those concepts separate.

---

# Idempotency

Ingestion jobs must be safe to retry.

If the same job executes twice, it must not create duplicate active chunks or duplicate vectors.

Prefer:

```text
upsert
```

where appropriate.

Use PostgreSQL constraints to enforce uniqueness.

Do not rely only on:

```ts
if (!exists) {
  insert();
}
```

because concurrent workers can still race.

Database-level constraints are required for correctness.

---

# Async Processing

Document processing must not happen synchronously inside the upload request.

Expected flow:

```text
POST /documents
       ↓
validate input
       ↓
create document
       ↓
create document version
       ↓
create ingestion job
       ↓
enqueue BullMQ job
       ↓
return job ID
```

Worker:

```text
BullMQ job
    ↓
load document
    ↓
parse
    ↓
normalize
    ↓
chunk
    ↓
hash
    ↓
compare
    ↓
embed changed chunks
    ↓
update vector index
    ↓
mark version ready
    ↓
mark job completed
```

---

# BullMQ

Use BullMQ for:

* asynchronous processing
* retries
* delayed jobs
* concurrency
* job state
* backoff

Use separate queues only when there is a meaningful reason.

Initially one ingestion/indexing queue is sufficient.

Example:

```text
ingestion
```

Do not create:

```text
parse-queue
chunk-queue
hash-queue
embedding-queue
indexing-queue
```

unless scale or operational requirements actually justify separate queues.

---

# Retry Strategy

Retry transient errors.

Examples:

* embedding API timeout
* provider rate limit
* Redis temporary failure
* PostgreSQL temporary connection failure
* network error

Do not endlessly retry permanent errors.

Examples:

* corrupt PDF
* unsupported format
* invalid document
* malformed configuration

Use exponential backoff.

Track:

```text
attempts
last_error
failure_reason
```

---

# Concurrency

Workers must be safe under concurrent execution.

Potential scenario:

```text
Worker A → document version 5
Worker B → document version 5
```

The system must not produce duplicate active vectors.

Use:

* database constraints
* transactions
* idempotent upserts
* job-level controls where appropriate

Do not assume the queue alone guarantees exactly-once processing.

BullMQ jobs should be treated as **at-least-once execution**.

---

# Database Transactions

Use transactions around logically atomic state changes.

Examples:

```text
create document version
+
create ingestion job
```

and:

```text
update chunks
+
update document version status
```

Do not hold long-running database transactions while waiting for external embedding APIs.

Avoid:

```text
BEGIN
  database work
  ↓
  API request
  ↓
  API request
  ↓
COMMIT
```

External network calls should generally happen outside long database transactions.

---

# Embedding Provider

Create a provider abstraction:

```ts
interface EmbeddingProvider {
  embedDocuments(
    texts: string[]
  ): Promise<number[][]>;

  embedQuery(
    text: string
  ): Promise<number[]>;
}
```

Support batching.

Do not make one embedding API request per chunk if the provider supports batch embedding.

The embedding implementation must be replaceable.

---

# Embedding Metrics

Track:

```text
embedding_requests
embedding_chunks
embedding_failures
embedding_latency
chunks_reused
chunks_reembedded
```

A key metric:

```text
embedding_reuse_rate
```

Example:

```text
1000 chunks
920 reused
80 embedded

Reuse rate = 92%
```

This metric demonstrates whether incremental indexing is actually providing value.

---

# Vector Storage

Use PostgreSQL + pgvector.

The vector dimension must match the configured embedding model.

Do not hardcode vector dimensions throughout the codebase.

Configuration should determine the expected dimension.

Vector search should use pgvector similarity search.

Initially support:

```text
cosine similarity
```

Only add additional distance metrics if there is a real use case.

---

# Retrieval API

Expose:

```text
POST /search
```

Example request:

```json
{
  "query": "How does authentication work?",
  "topK": 5
}
```

Response:

```json
{
  "query": "How does authentication work?",
  "results": [
    {
      "chunkId": "...",
      "documentId": "...",
      "content": "...",
      "score": 0.91,
      "metadata": {}
    }
  ]
}
```

Do not expose unnecessary internal database fields.

Validate requests with Zod.

---

# Retrieval Pipeline

Basic:

```text
Query
 ↓
Query embedding
 ↓
pgvector similarity search
 ↓
Top-K
 ↓
Results
```

Optional future:

```text
Query
 ↓
Query embedding
 ↓
Vector search
 ↓
Candidate set
 ↓
Reranker
 ↓
Top-K
 ↓
LLM
```

Do not implement reranking until basic retrieval is evaluated.

---

# Retrieval Quality

Retrieval quality is a first-class feature.

Do not judge the system only by whether an LLM produces a plausible answer.

Create an evaluation dataset.

Example:

```json
{
  "question": "How do I reset my API token?",
  "expectedDocuments": [
    "authentication.md"
  ]
}
```

Measure:

```text
Recall@K
MRR
```

Optionally:

```text
Precision@K
nDCG
retrieval latency
```

---

# Evaluation Dataset

Store evaluation data in:

```text
evaluation/datasets/
```

Keep it version-controlled.

Example:

```text
evaluation/
├── datasets/
│   └── retrieval.json
├── benchmarks/
└── scripts/
```

The evaluation runner should be executable from the command line.

Example:

```bash
bun run evaluate
```

---

# Chunking Experiments

Make chunking configuration easy to change.

Example:

```text
Experiment A
chunk_size = 256
chunk_overlap = 32

Experiment B
chunk_size = 512
chunk_overlap = 64
```

Compare:

```text
Recall@5
MRR
embedding count
index size
retrieval latency
```

Do not assume larger chunks are always better.

Use measurements.

---

# Optional RAG Generation

Only implement generation after retrieval is functioning correctly.

Pipeline:

```text
User query
    ↓
Retrieve
    ↓
Top-K chunks
    ↓
Context construction
    ↓
LLM
    ↓
Answer
```

The generation endpoint should be separate from `/search`.

Example:

```text
POST /generate
```

Response should include citations/source references.

The LLM should not be allowed to silently invent sources.

---

# Source Attribution

Retrieved chunks should retain source information.

For example:

```text
source
filename
page_number
section
chunk_id
```

Generation should be able to reference the retrieved source.

The system should make it possible to answer:

> "Which documents were used to generate this answer?"

---

# API Endpoints

Initial API:

```text
POST   /documents
GET    /documents
GET    /documents/:id
DELETE /documents/:id

POST   /documents/:id/reindex

GET    /jobs/:id

POST   /search

POST   /generate
```

Health:

```text
GET /health
```

Do not create endpoints without a clear use case.

---

# API Design Rules

Routes should be thin.

Bad:

```ts
app.post("/documents", async (request, reply) => {
  // 300 lines of ingestion logic
});
```

Preferred:

```ts
app.post("/documents", async (request, reply) => {
  const input = createDocumentSchema.parse(request.body);

  const document =
    await documentService.create(input);

  return reply.send(document);
});
```

Business logic belongs in services.

Database access belongs in repositories.

Validation belongs in schemas.

---

# Error Handling

Create explicit application errors.

Examples:

```text
DocumentNotFoundError
UnsupportedDocumentTypeError
DocumentParseError
ChunkingError
EmbeddingProviderError
VectorIndexError
IngestionJobError
```

Map domain errors to appropriate HTTP responses.

Never expose:

* stack traces
* API keys
* internal database errors
* provider secrets

through production API responses.

---

# Configuration

Use typed configuration.

Required environment variables may include:

```text
DATABASE_URL
REDIS_URL

EMBEDDING_PROVIDER
EMBEDDING_MODEL
EMBEDDING_API_KEY

LLM_PROVIDER
LLM_MODEL
LLM_API_KEY

CHUNK_SIZE
CHUNK_OVERLAP

DEFAULT_TOP_K
VECTOR_DIMENSION
```

Provide:

```text
.env.example
```

Never commit secrets.

Application startup should fail clearly when required configuration is missing.

---

# Logging

Use structured logging.

Include useful identifiers:

```text
job_id
document_id
document_version_id
chunk_id
operation
status
duration
error
```

Avoid logging entire document contents unless explicitly required for debugging.

Never log:

* API keys
* authorization tokens
* credentials

---

# Observability

Track at minimum:

```text
documents_ingested
documents_failed

chunks_created
chunks_reused
chunks_reembedded

embedding_requests
embedding_failures

ingestion_latency
embedding_latency
retrieval_latency

retrieval_requests
retrieval_failures
```

The most important Indexa-specific metrics are:

```text
chunks_reused
chunks_reembedded
embedding_reuse_rate
```

---

# Testing Strategy

Testing is mandatory.

## Unit Tests

Test:

* normalization
* parsers
* chunking
* hashing
* change detection
* incremental comparison
* metadata generation

---

## Integration Tests

Test:

```text
document
 ↓
job
 ↓
worker
 ↓
database
 ↓
embedding mock
 ↓
pgvector
```

---

# Critical Incremental Indexing Test

This test is mandatory.

Initial document:

```text
100 chunks
```

Updated document:

```text
100 chunks
```

Only:

```text
5 chunks changed
```

Expected:

```text
5 embedding operations
```

Not:

```text
100 embedding operations
```

The test should use a fake embedding provider that counts calls.

Example:

```ts
expect(fakeEmbeddingProvider.calls).toBe(5);
```

This is one of the most important correctness tests in the project.

---

# Idempotency Test

Run the same ingestion job twice.

Expected:

```text
no duplicate active chunks
no duplicate vectors
consistent document state
```

---

# Retry Test

Simulate:

```text
embedding provider failure
```

Verify:

```text
job retries
backoff occurs
eventual success works
failure state is recorded if retries are exhausted
```

---

# Concurrency Test

Simulate two workers processing the same logical indexing operation.

Expected:

```text
no duplicate active chunks
no corrupted document state
```

---

# External Provider Tests

Do not make automated tests depend on real embedding or LLM APIs.

Use:

```ts
FakeEmbeddingProvider
FakeLLMProvider
```

The fake embedding provider should return deterministic vectors.

This allows retrieval tests to remain reproducible.

---

# Docker Development Environment

Use Docker Compose for infrastructure.

Initially:

```text
PostgreSQL + pgvector
Redis
```

Example:

```text
docker-compose.yml
```

The local environment should be reproducible.

The API and worker may run directly with Bun during development.

---

# Commands

Provide simple commands for:

```bash
bun install

bun run dev

bun run dev:api

bun run dev:worker

bun run test

bun run lint

bun run typecheck

bun run format

bun run db:migrate

bun run db:generate

bun run evaluate
```

Exact scripts may differ, but the developer workflow must remain simple.

---

# Development Workflow

Before starting a milestone:

1. Inspect the existing repository.
2. Understand the current architecture.
3. Identify affected components.
4. Read relevant tests.
5. Plan the smallest implementation.
6. Implement.
7. Run tests.
8. Run type checking.
9. Run linting.
10. Verify the application still starts.

Do not blindly rewrite existing code.

---

# AI Coding Agent Rules

## Rule 1 — Do Not Guess

If the repository already contains an implementation, inspect it before creating a replacement.

Do not assume the repository structure matches this document exactly.

The actual repository is the source of truth for existing code.

---

## Rule 2 — Preserve Existing Architecture

Do not introduce:

* another framework
* another ORM
* another queue
* another database
* another vector database

unless there is a documented technical reason.

---

## Rule 3 — Keep Core Logic Explicit

The following must remain understandable:

```text
incremental indexing
content hashing
chunk comparison
embedding reuse
job state transitions
retrieval
```

Do not hide critical behavior behind unnecessary abstractions.

---

## Rule 4 — External APIs Must Be Abstracted

Embedding and LLM providers must remain replaceable.

Provider-specific code should not leak into:

* chunking
* indexing
* retrieval
* domain models

---

## Rule 5 — Database Is the Source of Truth

Redis/BullMQ manages asynchronous jobs.

PostgreSQL manages persistent application state.

Do not treat Redis job state as the permanent source of truth for documents or chunks.

---

## Rule 6 — Assume At-Least-Once Execution

Workers may execute the same job more than once.

Every indexing operation must therefore be safe to retry.

Design for:

```text
at-least-once execution
+
idempotent processing
```

Do not assume exactly-once semantics.

---

## Rule 7 — No Long External Calls Inside DB Transactions

Do not keep database transactions open while waiting for:

* embedding APIs
* LLM APIs
* external file downloads

Use short database transactions around state changes.

---

## Rule 8 — Do Not Fake Completion

Never mark a milestone complete if:

* tests fail
* type checking fails
* API does not start
* worker does not start
* migrations fail
* indexing is broken
* Docker infrastructure is unavailable
* known blocking errors remain

Report the actual state.

---

## Rule 9 — Fix Blockers Before Continuing

If a milestone creates a blocking issue:

```text
STOP
 ↓
diagnose
 ↓
fix
 ↓
test
 ↓
verify
 ↓
continue
```

Do not knowingly build the next milestone on broken infrastructure.

---

## Rule 10 — Keep Changes Focused

Avoid unrelated refactoring.

A change should ideally correspond to:

```text
one feature
one bug fix
one architectural decision
```

Do not reformat unrelated files.

---

# Milestones

## Milestone 1 — Foundation

Build:

* Bun + TypeScript project
* Fastify API
* PostgreSQL
* pgvector
* Redis
* BullMQ
* Drizzle
* Zod
* environment configuration
* Docker Compose
* health endpoint
* initial migrations

Acceptance:

```text
API starts
PostgreSQL connects
Redis connects
pgvector is available
tests run
typecheck passes
```

---

## Milestone 2 — Document Ingestion

Implement:

* document model
* upload endpoint
* Markdown/TXT parser
* document persistence
* document status

Acceptance:

```text
upload document
→ persist document
→ retrieve document
```

---

## Milestone 3 — Chunking

Implement:

* deterministic chunker
* token-aware chunking
* configurable chunk size
* configurable overlap
* chunk persistence
* SHA-256 hashing

Add unit tests.

---

## Milestone 4 — Embeddings

Implement:

* embedding provider interface
* provider implementation
* batching
* embedding persistence
* fake provider

Add tests verifying embedding calls.

---

## Milestone 5 — Vector Search

Implement:

```text
query
 ↓
query embedding
 ↓
pgvector similarity search
 ↓
top-k
```

Expose:

```text
POST /search
```

---

## Milestone 6 — Incremental Indexing

Implement:

* document versions
* content hashes
* chunk comparison
* embedding reuse
* changed chunk re-embedding
* removed chunk handling
* active/inactive indexing state

Acceptance:

```text
100 chunks
→ modify 5
→ only 5 re-embedded
```

---

## Milestone 7 — Async Processing

Implement:

* BullMQ
* Redis
* ingestion worker
* job state
* retries
* exponential backoff
* job status endpoint

The upload API must return without waiting for indexing completion.

---

## Milestone 8 — Reliability

Implement:

* idempotency
* database uniqueness constraints
* safe upserts
* retry handling
* failure recovery
* concurrency protection

Add integration tests.

---

## Milestone 9 — Retrieval Evaluation

Implement:

* evaluation dataset
* Recall@K
* MRR
* retrieval latency
* benchmark runner

Support chunking experiments.

---

## Milestone 10 — RAG Generation

Only after retrieval is validated:

```text
query
 ↓
retrieve
 ↓
context construction
 ↓
LLM
 ↓
answer
 ↓
citations
```

Keep `/generate` separate from `/search`.

---

# Definition of Done

A milestone is complete only when:

* implementation exists
* relevant tests exist
* tests pass
* type checking passes
* linting passes
* migrations work
* API starts
* worker starts when applicable
* affected APIs work
* error handling exists
* documentation is updated
* no known blocking issue remains

---

# Final Architecture

The intended system should ultimately resemble:

```text
                       ┌─────────────────┐
                       │    Next.js      │
                       │    Dashboard    │
                       └────────┬────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │     Fastify     │
                       │      API        │
                       └───────┬─────────┘
                               │
               ┌───────────────┼────────────────┐
               │               │                │
               ▼               ▼                ▼
          PostgreSQL        BullMQ            Search
          + pgvector          │                │
                              ▼                │
                         ┌─────────┐           │
                         │ Worker  │           │
                         └────┬────┘           │
                              │                │
                    ┌─────────┼─────────┐      │
                    ▼         ▼         ▼      │
                 Parser    Chunker   Embedder   │
                              │         │       │
                              └────┬────┘       │
                                   │            │
                                   ▼            │
                              pgvector ◄────────┘
```

---

# Portfolio Definition

The completed project should be described as:

> **Indexa — Incremental RAG Infrastructure**
>
> Built a TypeScript-based RAG indexing and retrieval system with asynchronous document processing, content-hash-based incremental indexing, idempotent BullMQ workers, PostgreSQL/pgvector vector search, and retrieval evaluation using Recall@K and MRR.

The core engineering story is:

```text
Reliable ingestion
        +
Deterministic chunking
        +
Content hashing
        +
Incremental indexing
        +
Embedding reuse
        +
Async workers
        +
Idempotency
        +
Vector retrieval
        +
Evaluation
```

Prioritize **correctness, reliability, incremental processing, observability, and measurable retrieval quality** over feature count.

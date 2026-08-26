# Incremental Indexing

Incremental indexing is Indexa's defining feature. When a document changes, Indexa parses the new version, chunks it deterministically, hashes each chunk with SHA-256, and compares hashes against the previous version.

- Unchanged chunks (`same content_hash`) reuse their existing embeddings.
- New or changed chunks are re-embedded and upserted.
- Deleted chunks (in previous but not in new) are excluded from the active index — only `currentVersion`'s chunks are queried.

Example: Version 1 has hashes A,B,C,D. Version 2 has A,X,C,Y. Then A and C reuse embeddings; only B→X and D→Y are re-embedded (2 embeddings, not 4). For 100 chunks with 5 changed, only 5 embeddings are needed.

Content hashing uses SHA-256 over normalized text; chunk identity is `document_id + content_hash`, not database UUIDs.

Embedding reuse rate `chunks_reused / total_chunks` demonstrates value — e.g. 920 reused / 1000 total = 92%.

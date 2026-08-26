# Chunking

Indexa uses deterministic token-aware chunking. The chunker splits normalized document text into sliding windows of `chunkSize` tokens with `chunkOverlap` overlap. Same input + same configuration always yields identical chunks.

## Configuration

- `CHUNK_SIZE` default 512 tokens
- `CHUNK_OVERLAP` default 50 tokens (must be < chunkSize)

Chunk content is joined with single spaces and hashed with SHA-256 over normalized text for content identity. Metadata such as `heading` and `title` is propagated to each chunk.

## Example

With `chunkSize=4` and `overlap=2`, the text `a b c d e f g h` yields `a b c d`, `c d e f`, `e f g h`.

Choose larger chunks for more context or smaller chunks for finer retrieval granularity.

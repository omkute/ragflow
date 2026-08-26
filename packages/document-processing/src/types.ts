/** Normalized parser output, independent from chunking, embedding and storage. */
export interface ParsedDocument {
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * Common interface for all format-specific parsers.
 * A parser knows nothing about vectors, the database or HTTP.
 */
export interface DocumentParser {
  supports(contentType: string): boolean;
  parse(input: Buffer): Promise<ParsedDocument>;
}

import { MarkdownParser } from './markdown-parser';
import { TextParser } from './text-parser';
import type { DocumentParser } from './types';

const PARSERS: DocumentParser[] = [new MarkdownParser(), new TextParser()];

/** All content types the ingestion pipeline currently accepts. */
export const SUPPORTED_CONTENT_TYPES = ['text/markdown', 'text/plain'] as const;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
};

/**
 * Maps a filename extension to a content type.
 * Returns undefined for unknown extensions.
 */
export function contentTypeFromFilename(filename: string): string | undefined {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === undefined) return undefined;
  return EXTENSION_CONTENT_TYPES[extension];
}

/** Finds a parser for the given content type, or undefined if unsupported. */
export function selectParser(contentType: string): DocumentParser | undefined {
  return PARSERS.find((parser) => parser.supports(contentType));
}

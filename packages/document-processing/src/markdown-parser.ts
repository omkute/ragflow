import { normalizeText } from './normalize';
import type { DocumentParser, ParsedDocument } from './types';

/** Extracts the first ATX H1 heading as a title, when present. */
function extractTitle(text: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(text);
  return match?.[1]?.trim() || undefined;
}

export class MarkdownParser implements DocumentParser {
  supports(contentType: string): boolean {
    return contentType === 'text/markdown';
  }

  async parse(input: Buffer): Promise<ParsedDocument> {
    const text = normalizeText(input);
    const title = extractTitle(text);

    return {
      text,
      metadata: title === undefined ? {} : { title },
    };
  }
}

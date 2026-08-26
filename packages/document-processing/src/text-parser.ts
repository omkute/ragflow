import { normalizeText } from './normalize';
import type { DocumentParser, ParsedDocument } from './types';

export class TextParser implements DocumentParser {
  supports(contentType: string): boolean {
    return contentType === 'text/plain';
  }

  async parse(input: Buffer): Promise<ParsedDocument> {
    return { text: normalizeText(input), metadata: {} };
  }
}

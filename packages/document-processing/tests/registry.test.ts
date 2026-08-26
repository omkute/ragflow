import { describe, expect, test } from 'bun:test';
import { SUPPORTED_CONTENT_TYPES, contentTypeFromFilename, selectParser } from '../src/registry';

describe('registry', () => {
  test('selects the markdown parser for text/markdown', () => {
    expect(selectParser('text/markdown')?.constructor.name).toBe('MarkdownParser');
  });

  test('selects the text parser for text/plain', () => {
    expect(selectParser('text/plain')?.constructor.name).toBe('TextParser');
  });

  test('returns undefined for unsupported content types', () => {
    expect(selectParser('application/pdf')).toBeUndefined();
    expect(selectParser('application/json')).toBeUndefined();
  });

  test('maps filename extensions to content types', () => {
    expect(contentTypeFromFilename('notes.md')).toBe('text/markdown');
    expect(contentTypeFromFilename('README.MARKDOWN')).toBe('text/markdown');
    expect(contentTypeFromFilename('plain.TXT')).toBe('text/plain');
    expect(contentTypeFromFilename('image.png')).toBeUndefined();
    expect(contentTypeFromFilename('no-extension')).toBeUndefined();
  });

  test('declares exactly the supported content types', () => {
    expect(SUPPORTED_CONTENT_TYPES).toEqual(['text/markdown', 'text/plain']);
    for (const contentType of SUPPORTED_CONTENT_TYPES) {
      expect(selectParser(contentType)).toBeDefined();
    }
  });
});

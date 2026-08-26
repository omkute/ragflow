import { describe, expect, test } from 'bun:test';
import { MarkdownParser } from '../src/markdown-parser';
import { TextParser } from '../src/text-parser';

describe('MarkdownParser', () => {
  const parser = new MarkdownParser();

  test('supports text/markdown only', () => {
    expect(parser.supports('text/markdown')).toBe(true);
    expect(parser.supports('text/plain')).toBe(false);
  });

  test('parses normalized text', async () => {
    const parsed = await parser.parse(Buffer.from('# Title\r\n\r\nBody'));
    expect(parsed.text).toBe('# Title\n\nBody');
  });

  test('extracts the first H1 as title metadata', async () => {
    const parsed = await parser.parse(Buffer.from('intro\n\n# Real Title\n## Sub'));
    expect(parsed.metadata.title).toBe('Real Title');
  });

  test('omits title metadata when no H1 exists', async () => {
    const parsed = await parser.parse(Buffer.from('just text'));
    expect(parsed.metadata).toEqual({});
  });
});

describe('TextParser', () => {
  const parser = new TextParser();

  test('supports text/plain only', () => {
    expect(parser.supports('text/plain')).toBe(true);
    expect(parser.supports('text/markdown')).toBe(false);
  });

  test('parses normalized text without metadata', async () => {
    const parsed = await parser.parse(Buffer.from('  plain\r\ntext\n\n\n'));
    expect(parsed.text).toBe('plain\ntext');
    expect(parsed.metadata).toEqual({});
  });
});

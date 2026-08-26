import { describe, expect, test } from 'bun:test';
import { normalizeText } from '../src/normalize';

describe('normalizeText', () => {
  test('is deterministic', () => {
    const raw = Buffer.from('# Title\r\n\r\nHello   world\u200B\n\n\n\n\ntail  ');
    expect(normalizeText(raw)).toBe(normalizeText(raw));
  });

  test('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  test('strips BOM and zero-width characters', () => {
    expect(normalizeText('\uFEFFa​b\u200Dc')).toBe('abc');
  });

  test('collapses runs of blank lines to one blank line', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  test('trims leading and trailing whitespace only', () => {
    expect(normalizeText('   \n\nhello\n\n  ')).toBe('hello');
  });

  test('preserves intra-line whitespace', () => {
    expect(normalizeText('code:    spaced')).toBe('code:    spaced');
  });

  test('decodes buffers as UTF-8', () => {
    expect(normalizeText(Buffer.from('héllo'))).toBe('héllo');
  });
});

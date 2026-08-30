import { describe, expect, test } from 'bun:test';
import { isSupportedDocument } from './validation';

describe('document validation', () => {
  test('accepts markdown and text files case-insensitively', () => {
    expect(isSupportedDocument('README.md')).toBe(true);
    expect(isSupportedDocument('notes.TXT')).toBe(true);
  });
  test('rejects unsupported file types', () => {
    expect(isSupportedDocument('report.pdf')).toBe(false);
    expect(isSupportedDocument('notes')).toBe(false);
  });
});

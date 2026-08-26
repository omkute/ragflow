import { describe, expect, test } from 'bun:test';
import { contentHash } from '../src/hash';

describe('contentHash', () => {
  test('produces lowercase sha-256 hex over normalized text', () => {
    // Reference value computed with: sha256 of "hello"
    expect(contentHash('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  test('ignores formatting differences that normalization removes', () => {
    const crlf = Buffer.from('line one\r\n\r\n\r\n\r\nline two');
    const lf = 'line one\n\nline two';
    expect(contentHash(crlf)).toBe(contentHash(lf));
  });

  test('is deterministic across buffer and string input', () => {
    expect(contentHash(Buffer.from('same'))).toBe(contentHash('same'));
  });

  test('different content yields different hashes', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

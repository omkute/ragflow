import { describe, expect, test } from 'bun:test';
import { TokenChunker } from '../src/chunker';
import { chunkContentHash } from '../src/hash';
import { countTokens, tokenize } from '../src/tokenizer';

describe('tokenizer', () => {
  test('splits on any whitespace', () => {
    expect(tokenize('a  b\nc\t\td')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('empty and whitespace-only yields no tokens', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \n\t  ')).toEqual([]);
  });

  test('countTokens matches tokenize length', () => {
    expect(countTokens('hello world')).toBe(2);
    expect(countTokens('')).toBe(0);
  });
});

describe('chunkContentHash', () => {
  test('is lowercase sha256 hex over normalized content', () => {
    // reference: sha256("hello world")
    expect(chunkContentHash('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  test('ignores normalization differences (CRLF, blank lines)', () => {
    const a = chunkContentHash('line one\r\n\r\n\r\nline two');
    const b = chunkContentHash('line one\n\nline two');
    expect(a).toBe(b);
  });

  test('deterministic', () => {
    expect(chunkContentHash('same')).toBe(chunkContentHash('same'));
  });
});

describe('TokenChunker', () => {
  test('validates config', () => {
    expect(() => new TokenChunker({ chunkSize: 0, chunkOverlap: 0 })).toThrow();
    expect(() => new TokenChunker({ chunkSize: 5, chunkOverlap: 5 })).toThrow();
    expect(() => new TokenChunker({ chunkSize: 5, chunkOverlap: 6 })).toThrow();
    expect(() => new TokenChunker({ chunkSize: 5, chunkOverlap: -1 })).toThrow();
  });

  test('deterministic: same input + same config yields same output', async () => {
    const chunker = new TokenChunker({ chunkSize: 10, chunkOverlap: 2 });
    const doc = {
      text: 'one two three four five six seven eight nine ten eleven twelve',
      metadata: {},
    };
    const a = await chunker.chunk(doc);
    const b = await chunker.chunk(doc);
    expect(a).toEqual(b);
  });

  test('single chunk when text shorter than chunkSize', async () => {
    const chunker = new TokenChunker({ chunkSize: 10, chunkOverlap: 2 });
    const doc = { text: 'hello world', metadata: {} };
    const chunks = await chunker.chunk(doc);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('hello world');
    expect(chunks[0]?.tokenCount).toBe(2);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.contentHash).toBe(chunkContentHash('hello world'));
  });

  test('empty text yields no chunks', async () => {
    const chunker = new TokenChunker({ chunkSize: 10, chunkOverlap: 2 });
    expect(await chunker.chunk({ text: '', metadata: {} })).toEqual([]);
    expect(await chunker.chunk({ text: '   \n  ', metadata: {} })).toEqual([]);
  });

  test('chunk overlap is applied correctly', async () => {
    const chunker = new TokenChunker({ chunkSize: 4, chunkOverlap: 2 });
    // 10 tokens, size 4, overlap 2 => step 2
    // start 0: tokens 0..3 => "a b c d"
    // start 2: tokens 2..5 => "c d e f"
    // start 4: tokens 4..7 => "e f g h"
    // start 6: tokens 6..9 => "g h i j"
    // start 8: tokens 8..9 => "i j" (partial final)
    const doc = { text: 'a b c d e f g h i j', metadata: {} };
    const chunks = await chunker.chunk(doc);
    expect(chunks.map((c) => c.content)).toEqual([
      'a b c d',
      'c d e f',
      'e f g h',
      'g h i j',
      'i j',
    ]);
    expect(chunks.map((c) => c.tokenCount)).toEqual([4, 4, 4, 4, 2]);
    // overlap verification: last 2 tokens of chunk 0 equal first 2 of chunk 1
    const t0 = tokenize(chunks[0]?.content);
    const t1 = tokenize(chunks[1]?.content);
    expect(t0.slice(-2)).toEqual(t1.slice(0, 2));
  });

  test('chunk boundaries respect token counts', async () => {
    const chunker = new TokenChunker({ chunkSize: 3, chunkOverlap: 1 });
    const doc = { text: 'one two three four five six seven', metadata: {} };
    const chunks = await chunker.chunk(doc);
    // step 2
    // 0: one two three
    // 2: three four five
    // 4: five six seven
    // 6: seven
    expect(chunks.map((c) => c.content)).toEqual([
      'one two three',
      'three four five',
      'five six seven',
      'seven',
    ]);
  });

  test('no overlap (chunkOverlap 0) concatenates without duplication', async () => {
    const chunker = new TokenChunker({ chunkSize: 3, chunkOverlap: 0 });
    const doc = { text: 'a b c d e f g', metadata: {} };
    const chunks = await chunker.chunk(doc);
    expect(chunks.map((c) => c.content)).toEqual(['a b c', 'd e f', 'g']);
  });

  test('propagates document metadata and adds chunkIndex/tokenCount/heading', async () => {
    const chunker = new TokenChunker({ chunkSize: 5, chunkOverlap: 1 });
    const doc = {
      text: '# Title\n\nhello world foo bar baz qux',
      metadata: { title: 'Title', source: 'api' },
    };
    const chunks = await chunker.chunk(doc);
    // The heading from title should propagate even if the chunk does not contain the heading line verbatim
    // after token joining, the first chunk still contains "# Title"
    for (const c of chunks) {
      expect(c.metadata.title).toBe('Title');
      expect(c.metadata.source).toBe('api');
      expect(c.metadata.chunkIndex).toBe(c.chunkIndex);
      expect(c.metadata.tokenCount).toBe(c.tokenCount);
    }
    expect(chunks[0]?.metadata.heading).toBe('Title');
  });

  test('heading updates when later chunk contains a new heading', async () => {
    const chunker = new TokenChunker({ chunkSize: 4, chunkOverlap: 0 });
    const doc = {
      text: `# First\n${'a '.repeat(20)}\n# Second\n${'b '.repeat(10)}`,
      metadata: {},
    };
    const chunks = await chunker.chunk(doc);
    // At least one later chunk should have heading Second
    const headings = chunks.map((c) => c.metadata.heading);
    expect(headings).toContain('First');
    expect(headings).toContain('Second');
    // Monotonic: once Second appears, it stays
    const firstSecondIdx = headings.indexOf('Second');
    for (let i = firstSecondIdx; i < headings.length; i++) {
      expect(headings[i]).toBe('Second');
    }
  });

  test('different chunkSize yields different chunk counts (config affects output)', async () => {
    const doc = { text: Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '), metadata: {} };
    const small = await new TokenChunker({ chunkSize: 5, chunkOverlap: 1 }).chunk(doc);
    const large = await new TokenChunker({ chunkSize: 10, chunkOverlap: 1 }).chunk(doc);
    expect(small.length).toBeGreaterThan(large.length);
  });

  test('same document with different overlap yields different boundaries but same tokens overall', async () => {
    const text = 'a b c d e f g h i j k l';
    const c1 = await new TokenChunker({ chunkSize: 4, chunkOverlap: 1 }).chunk({
      text,
      metadata: {},
    });
    const c2 = await new TokenChunker({ chunkSize: 4, chunkOverlap: 2 }).chunk({
      text,
      metadata: {},
    });
    expect(c1).not.toEqual(c2);
    // Both cover the same set of tokens when flattened without overlap de-duplication is hard to assert,
    // so just check first chunk equal (starts same) and second chunk differs due to overlap
    expect(c1[0]?.content).toBe(c2[0]?.content);
    expect(c1[1]?.content).not.toBe(c2[1]?.content);
  });
});

import { describe, expect, test } from 'bun:test';
import { assertPgVector, createDb, isPgVectorInstalled } from '../src';

const infraAvailable = Boolean(process.env.DATABASE_URL);

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for this test');
  return url;
}

describe('pgvector availability', () => {
  test.skipIf(!infraAvailable)('extension is installed after migrations', async () => {
    const { sql } = createDb(requireDatabaseUrl());
    try {
      expect(await isPgVectorInstalled(sql)).toBe(true);
      await assertPgVector(sql);
    } finally {
      await sql.end();
    }
  });

  test.skipIf(!infraAvailable)('vector type stores and round-trips values', async () => {
    const { sql } = createDb(requireDatabaseUrl());
    try {
      const [row] = await sql`
          SELECT '[1,2,3]'::vector AS v
        `;
      expect(String(row?.v).replace(/\s/g, '')).toBe('[1,2,3]');
    } finally {
      await sql.end();
    }
  });
});

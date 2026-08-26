import type { PgSql } from './client';

/** Verifies the pgvector extension is installed in the connected database. */
export async function isPgVectorInstalled(sql: PgSql): Promise<boolean> {
  const rows = await sql`
    SELECT extname
    FROM pg_extension
    WHERE extname = 'vector'
  `;
  return rows.length > 0;
}

/**
 * Asserts pgvector availability and that the `vector` type is usable.
 * Throws with a clear message when the extension is missing.
 */
export async function assertPgVector(sql: PgSql): Promise<void> {
  const installed = await isPgVectorInstalled(sql);

  if (!installed) {
    throw new Error(
      'pgvector extension is not installed. Run migrations (`bun run db:migrate`) against this database.',
    );
  }

  await sql`SELECT '[1,2,3]'::vector`;
}

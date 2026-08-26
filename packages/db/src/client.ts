import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDrizzleDb>;
export type PgSql = postgres.Sql;

function createDrizzleDb(sql: postgres.Sql) {
  return drizzle(sql, { schema });
}

export interface DbHandle {
  /** Drizzle query builder bound to the shared pool. */
  db: Database;
  /** Underlying postgres.js pool. Owns sockets; always `sql.end()` on shutdown. */
  sql: PgSql;
}

/**
 * Create a database handle from a connection string.
 *
 * postgres.js opens sockets lazily, so this never blocks or throws on its own;
 * connectivity problems surface on first query.
 */
export function createDb(databaseUrl: string): DbHandle {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return { db: createDrizzleDb(sql), sql };
}

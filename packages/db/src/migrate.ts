import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;
  const { db, sql } = createDb(databaseUrl);

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

await main();

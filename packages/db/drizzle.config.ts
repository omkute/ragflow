import { defineConfig } from 'drizzle-kit';

const here = (relative: string) => new URL(relative, import.meta.url).pathname;

export default defineConfig({
  dialect: 'postgresql',
  schema: here('./src/schema.ts'),
  out: here('./drizzle'),
});

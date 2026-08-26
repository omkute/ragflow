import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';

const infraAvailable = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  beforeAll(async () => {
    if (!infraAvailable) return;
    app = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: 'warn' }));
  });

  afterAll(async () => {
    await app?.close();
  });

  function requireApp(): FastifyInstance {
    if (!app) throw new Error('health test app was not initialized');
    return app;
  }

  test.skipIf(!infraAvailable)(
    'reports ok when postgres, pgvector and redis are reachable',
    async () => {
      const response = await requireApp().inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.checks.postgres.status).toBe('ok');
      expect(body.checks.pgvector.status).toBe('ok');
      expect(body.checks.redis.status).toBe('ok');
    },
  );

  test.skipIf(!infraAvailable)('includes latency measurements for each check', async () => {
    const response = await requireApp().inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(typeof body.checks.postgres.latencyMs).toBe('number');
    expect(typeof body.checks.redis.latencyMs).toBe('number');
    expect(typeof body.uptimeSeconds).toBe('number');
  });
});

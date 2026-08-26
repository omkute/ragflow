import type { PgSql } from '@indexa/db';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

export interface HealthRoutesOptions {
  sql: PgSql;
  redis: Redis;
}

interface CheckResult {
  status: 'ok' | 'unavailable';
  latencyMs?: number;
  error?: string;
}

/** Per-dependency deadline so /health always answers promptly. */
const CHECK_TIMEOUT_MS = 2000;

function withDeadline<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`check timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function measure(fn: () => Promise<unknown>): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    await withDeadline(fn());
    return { status: 'ok', latencyMs: round(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: 'unavailable',
      latencyMs: round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function checkPostgres(sql: PgSql): Promise<CheckResult> {
  return measure(async () => {
    await sql`SELECT 1`;
  });
}

async function checkPgVector(sql: PgSql): Promise<CheckResult> {
  return measure(async () => {
    const rows = await sql`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    if (rows.length === 0) {
      throw new Error('pgvector extension is not installed');
    }
  });
}

async function checkRedis(redis: Redis): Promise<CheckResult> {
  return measure(() => redis.ping());
}

/** GET /health — aggregate readiness of PostgreSQL, pgvector and Redis. */
export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [postgres, pgvector, redis] = await Promise.all([
      checkPostgres(options.sql),
      checkPgVector(options.sql),
      checkRedis(options.redis),
    ]);

    const checks = { postgres, pgvector, redis };
    const healthy = Object.values(checks).every((check) => check.status === 'ok');

    return reply
      .code(healthy ? 200 : 503)
      .header('cache-control', 'no-store')
      .send({
        status: healthy ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        checks,
      });
  });
}

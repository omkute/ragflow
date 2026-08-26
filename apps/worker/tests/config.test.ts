import { describe, expect, test } from 'bun:test';
import { ConfigurationError, loadConfig } from '../src/config';
import { INGESTION_QUEUE_NAME } from '../src/jobs/queues';

describe('worker config', () => {
  test('applies defaults for optional variables', () => {
    const config = loadConfig({
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://indexa:indexa@localhost:5432/indexa',
    });

    expect(config.WORKER_CONCURRENCY).toBe(2);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
  });

  test('coerces WORKER_CONCURRENCY', () => {
    const config = loadConfig({
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgresql://indexa:indexa@localhost:5432/indexa',
      WORKER_CONCURRENCY: '4',
    });
    expect(config.WORKER_CONCURRENCY).toBe(4);
  });

  test('fails clearly when REDIS_URL is missing', () => {
    try {
      loadConfig({});
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain('REDIS_URL');
    }
  });

  test('rejects invalid WORKER_CONCURRENCY', () => {
    expect(() =>
      loadConfig({
        REDIS_URL: 'redis://localhost:6379',
        DATABASE_URL: 'postgresql://indexa:indexa@localhost:5432/indexa',
        WORKER_CONCURRENCY: '0',
      }),
    ).toThrow(ConfigurationError);
  });
});

describe('queue naming', () => {
  test('uses a single ingestion queue', () => {
    expect(INGESTION_QUEUE_NAME).toBe('ingestion');
  });
});

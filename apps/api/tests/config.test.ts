import { describe, expect, test } from 'bun:test';
import { ConfigurationError, loadConfig } from '../src/config';

const baseEnv = {
  DATABASE_URL: 'postgresql://indexa:indexa@localhost:5432/indexa',
  REDIS_URL: 'redis://localhost:6379',
};

describe('api config', () => {
  test('applies defaults for optional variables', () => {
    const config = loadConfig(baseEnv);

    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.API_HOST).toBe('127.0.0.1');
    expect(config.API_PORT).toBe(3000);
  });

  test('coerces and validates API_PORT', () => {
    const config = loadConfig({ ...baseEnv, API_PORT: '8080' });
    expect(config.API_PORT).toBe(8080);

    expect(() => loadConfig({ ...baseEnv, API_PORT: 'not-a-number' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ ...baseEnv, API_PORT: '99999' })).toThrow(ConfigurationError);
  });

  test('fails clearly when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omitted, ...rest } = baseEnv;

    try {
      loadConfig(rest);
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain('DATABASE_URL');
    }
  });

  test('rejects non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: 'mysql://localhost/indexa' })).toThrow(
      /postgresql:\/\//,
    );
  });

  test('rejects non-redis REDIS_URL', () => {
    expect(() => loadConfig({ ...baseEnv, REDIS_URL: 'http://localhost:6379' })).toThrow(
      /redis:\/\//,
    );
  });
});

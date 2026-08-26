import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
      message: 'must be a redis:// connection string',
    }),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
});

export type WorkerConfig = z.infer<typeof envSchema>;

/** Thrown when required environment configuration is missing or invalid. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Parse and validate environment variables into typed config.
 * Fails fast with a message listing every offending variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(`Invalid worker configuration -> ${issues}`);
  }

  return result.data;
}

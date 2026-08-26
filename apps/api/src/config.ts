import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
        message: 'must be a postgresql:// connection string',
      }),
    REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'must be a redis:// connection string',
      }),
    CHUNK_SIZE: z.coerce.number().int().min(1).max(8192).default(512),
    CHUNK_OVERLAP: z.coerce.number().int().min(0).max(8191).default(50),
  })
  .superRefine((value, ctx) => {
    if (value.CHUNK_OVERLAP >= value.CHUNK_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CHUNK_OVERLAP'],
        message: 'CHUNK_OVERLAP must be < CHUNK_SIZE',
      });
    }
  });

export type ApiConfig = z.infer<typeof envSchema>;

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
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new ConfigurationError(`Invalid API configuration -> ${issues}`);
  }

  return result.data;
}

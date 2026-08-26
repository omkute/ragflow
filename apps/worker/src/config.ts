import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
    CHUNK_SIZE: z.coerce.number().int().min(1).max(8192).default(512),
    CHUNK_OVERLAP: z.coerce.number().int().min(0).max(8191).default(50),
    VECTOR_DIMENSION: z.coerce.number().int().min(8).max(4096).default(1536),
    EMBEDDING_PROVIDER: z.enum(['fake', 'openai']).default('fake'),
  })
  .superRefine((value, ctx) => {
    if (value.CHUNK_OVERLAP >= value.CHUNK_SIZE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CHUNK_OVERLAP'],
        message: 'CHUNK_OVERLAP must be < CHUNK_SIZE',
      });
    }
    if (value.VECTOR_DIMENSION !== 1536) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VECTOR_DIMENSION'],
        message:
          'VECTOR_DIMENSION must be 1536 to match the pgvector column (vector(1536)); change the dimension requires a new migration',
      });
    }
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

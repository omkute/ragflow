import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

/** Base class for explicit application errors mapped to HTTP responses. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, options: { statusCode: number; code: string }) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options.statusCode;
    this.code = options.code;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 500, code: 'CONFIGURATION_ERROR' });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR' });
  }
}

export class DocumentNotFoundError extends AppError {
  constructor(documentId: string) {
    super(`Document not found: ${documentId}`, {
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
    });
  }
}

export class UnsupportedDocumentTypeError extends AppError {
  constructor(contentType: string) {
    super(`Unsupported document content type: ${contentType}`, {
      statusCode: 415,
      code: 'UNSUPPORTED_DOCUMENT_TYPE',
    });
  }
}

export class DocumentParseError extends AppError {
  constructor(filename: string, cause: unknown) {
    super(`Failed to parse document: ${filename}`, {
      statusCode: 422,
      code: 'DOCUMENT_PARSE_ERROR',
    });
    this.cause = cause;
  }
}

/**
 * Validate untrusted input with a Zod schema, mapping failures to 400.
 * Keeps route handlers thin: `parseWith(schema, request.body)`.
 */
export function parseWith<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new BadRequestError(issues);
  }
  return result.data;
}

/** Map domain errors to HTTP responses without leaking internals. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          statusCode: error.statusCode,
          code: error.code,
          error: error.message,
        });
      }

      const statusCode =
        typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
          ? error.statusCode
          : 500;

      if (statusCode >= 500) {
        request.log.error({ err: error, requestId: request.id }, 'Unhandled request failure');
      }

      return reply.status(statusCode).send({
        statusCode,
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      });
    },
  );
}

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

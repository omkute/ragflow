import { describe, expect, test } from 'bun:test';
import { ApiError, api, isAbortError, parseApiError } from './api';

describe('API error parsing', () => {
  test('uses structured error code and message', () => {
    const error = parseApiError(
      415,
      'Unsupported Media Type',
      '{"code":"UNSUPPORTED","error":"Markdown only"}',
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(415);
    expect(error.code).toBe('UNSUPPORTED');
    expect(error.message).toBe('Markdown only');
  });
  test('keeps plain text failures readable', () => {
    const error = parseApiError(503, 'Service Unavailable', 'database offline');
    expect(error.code).toBe('REQUEST_FAILED');
    expect(error.message).toBe('database offline');
  });

  test('recognizes browser cancellation variants', () => {
    expect(isAbortError(new Error('signal is aborted without reason'))).toBe(true);
    expect(isAbortError(new Error('connection refused'))).toBe(false);
  });

  test('does not send a JSON content type for bodyless deletes', async () => {
    const originalFetch = globalThis.fetch;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      await api.deleteDocument('00000000-0000-4000-8000-000000000000');
      expect(new Headers(requestInit?.headers).has('content-type')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

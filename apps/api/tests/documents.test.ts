import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDocumentSchema, listDocumentsQuerySchema } from '../src/schemas/document-schemas';

const infraAvailable = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

const uniqueName = (base: string) =>
  `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('document schemas', () => {
  test('createDocumentSchema requires non-empty filename and content', () => {
    expect(createDocumentSchema.safeParse({ filename: '', content: 'x' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ filename: 'a.md' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ filename: 'a.md', content: '' }).success).toBe(false);
    expect(createDocumentSchema.safeParse({ filename: 'a.md', content: 'hello' }).success).toBe(
      true,
    );
  });

  test('listDocumentsQuerySchema applies bounds and defaults', () => {
    const parsed = listDocumentsQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.offset).toBe(0);
    expect(listDocumentsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listDocumentsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listDocumentsQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe('documents API', () => {
  let app: FastifyInstance | undefined;
  const createdIds: string[] = [];

  function requireApp(): FastifyInstance {
    if (!app) throw new Error('documents test app was not initialized');
    return app;
  }

  beforeAll(async () => {
    if (!infraAvailable) return;
    app = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: 'warn' }));
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await app?.inject({ method: 'DELETE', url: `/documents/${id}` });
    }
    await app?.close();
  });

  test.skipIf(!infraAvailable)('upload -> persist -> retrieve roundtrip', async () => {
    const filename = `${uniqueName('notes')}.md`;
    const rawContent = '# Integration Notes\r\n\r\nContent   kept.\n\n\n\n\nEnd.';

    const upload = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename, contentType: 'text/markdown', content: rawContent },
    });

    expect(upload.statusCode).toBe(201);
    const uploaded = upload.json();
    createdIds.push(uploaded.id);

    expect(uploaded.filename).toBe(filename);
    expect(uploaded.status).toBe('ready');
    expect(uploaded.currentVersion).toBe(1);
    expect(uploaded.version.version).toBe(1);
    expect(uploaded.version.status).toBe('ready');
    expect(uploaded.version.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(uploaded.version.completedAt).not.toBeNull();

    const detail = await requireApp().inject({
      method: 'GET',
      url: `/documents/${uploaded.id}`,
    });
    expect(detail.statusCode).toBe(200);
    const document = detail.json();
    expect(document.id).toBe(uploaded.id);
    // Normalized on persist (CRLF -> LF, blank-line collapse).
    expect(document.version.content).toBe('# Integration Notes\n\nContent   kept.\n\nEnd.');
    expect(document.version.metadata.title).toBe('Integration Notes');
  });

  test.skipIf(!infraAvailable)('derives content type from extension', async () => {
    const filename = `${uniqueName('plain')}.txt`;
    const upload = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename, content: 'just plain text' },
    });

    expect(upload.statusCode).toBe(201);
    const uploaded = upload.json();
    createdIds.push(uploaded.id);
    expect(uploaded.contentType).toBe('text/plain');
  });

  test.skipIf(!infraAvailable)('lists documents with total count', async () => {
    const filename = `${uniqueName('listed')}.md`;
    const upload = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename, content: '# Listed\nbody' },
    });
    expect(upload.statusCode).toBe(201);
    createdIds.push(upload.json().id);

    const response = await requireApp().inject({
      method: 'GET',
      url: '/documents?limit=5&offset=0',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(body.items.some((item: { id: string }) => item.id === upload.json().id)).toBe(true);
  });

  test.skipIf(!infraAvailable)('rejects unsupported content types with 415', async () => {
    const response = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: {
        filename: `${uniqueName('doc')}.pdf`,
        contentType: 'application/pdf',
        content: '%PDF-1.4 fake',
      },
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe('UNSUPPORTED_DOCUMENT_TYPE');
  });

  test.skipIf(!infraAvailable)('rejects invalid payloads with 400', async () => {
    const response = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { content: 'no filename' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  test.skipIf(!infraAvailable)('returns 404 for unknown document ids', async () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const getResponse = await requireApp().inject({
      method: 'GET',
      url: `/documents/${unknownId}`,
    });
    expect(getResponse.statusCode).toBe(404);
    expect(getResponse.json().code).toBe('DOCUMENT_NOT_FOUND');

    const deleteResponse = await requireApp().inject({
      method: 'DELETE',
      url: `/documents/${unknownId}`,
    });
    expect(deleteResponse.statusCode).toBe(404);
  });

  test.skipIf(!infraAvailable)('deletes documents and cascades versions', async () => {
    const upload = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename: `${uniqueName('gone')}.md`, content: '# Gone' },
    });
    expect(upload.statusCode).toBe(201);
    const { id } = upload.json();

    const deleted = await requireApp().inject({ method: 'DELETE', url: `/documents/${id}` });
    expect(deleted.statusCode).toBe(204);

    const verify = await requireApp().inject({ method: 'GET', url: `/documents/${id}` });
    expect(verify.statusCode).toBe(404);
  });
});

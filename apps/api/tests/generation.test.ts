import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { generateRequestSchema } from '../src/schemas/generation-schemas';

const infraAvailable = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe('generation schemas', () => {
  test('generateRequestSchema validates query and topK', () => {
    expect(generateRequestSchema.safeParse({ query: '' }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ query: 'hello' }).success).toBe(true);
    expect(generateRequestSchema.safeParse({ query: 'hello', topK: 0 }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ query: 'hello', topK: 101 }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ query: 'hello', systemPrompt: '' }).success).toBe(
      false,
    );
  });
});

describe('generation API', () => {
  let app: FastifyInstance | undefined;
  const createdIds: string[] = [];

  function requireApp(): FastifyInstance {
    if (!app) throw new Error('generation test app not initialized');
    return app;
  }

  beforeAll(async () => {
    if (!infraAvailable) return;
    app = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: 'warn', NODE_ENV: 'test' }));
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await app?.inject({ method: 'DELETE', url: `/documents/${id}` });
    }
    await app?.close();
  });

  test.skipIf(!infraAvailable)(
    'generate returns answer with citations separate from search',
    async () => {
      const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const filename = `gen-${uniq}.md`;
      const content = `# Gen Doc ${uniq}\n\nRetrieval augmented generation combines search and LLM. The answer must cite sources. ${uniq}`;

      const upload = await requireApp().inject({
        method: 'POST',
        url: '/documents',
        payload: { filename, content },
      });
      expect(upload.statusCode).toBe(201);
      const doc = upload.json();
      createdIds.push(doc.id);
      expect(doc.status).toBe('ready');

      // Fetch chunk content for exact query to guarantee retrieval
      const chunksRes = await requireApp().inject({
        method: 'GET',
        url: `/documents/${doc.id}/chunks`,
      });
      expect(chunksRes.statusCode).toBe(200);
      const chunkContent = chunksRes.json().chunks[0].content as string;

      // Search should return hits
      const searchRes = await requireApp().inject({
        method: 'POST',
        url: '/search',
        payload: { query: chunkContent, topK: 3 },
      });
      expect(searchRes.statusCode).toBe(200);
      expect(searchRes.json().results.length).toBeGreaterThanOrEqual(1);

      // Generate with same query — should return answer + citations
      const genRes = await requireApp().inject({
        method: 'POST',
        url: '/generate',
        payload: { query: chunkContent, topK: 3 },
      });
      expect(genRes.statusCode).toBe(200);
      const body = genRes.json();
      expect(body.query).toBe(chunkContent);
      expect(typeof body.answer).toBe('string');
      expect(body.answer.length).toBeGreaterThan(0);
      expect(Array.isArray(body.citations)).toBe(true);
      expect(body.citations.length).toBeGreaterThanOrEqual(1);
      expect(body.retrievedCount).toBe(body.citations.length);

      // Citations must include source attribution fields and be usable for "which documents were used"
      for (const c of body.citations) {
        expect(typeof c.chunkId).toBe('string');
        expect(typeof c.documentId).toBe('string');
        expect(typeof c.content).toBe('string');
        expect(typeof c.score).toBe('number');
        expect(typeof c.metadata).toBe('object');
      }

      // Answer should reference citations or context count (fake provider behavior)
      expect(body.answer).toContain('[');

      // Document filter should still work for generation
      const filtered = await requireApp().inject({
        method: 'POST',
        url: '/generate',
        payload: { query: chunkContent, topK: 3, documentId: doc.id },
      });
      expect(filtered.statusCode).toBe(200);
      for (const c of filtered.json().citations) {
        expect(c.documentId).toBe(doc.id);
      }

      // Ensure generate is separate endpoint from search (different response shape)
      expect(body).not.toHaveProperty('results');
      expect(searchRes.json()).not.toHaveProperty('answer');
    },
  );

  test.skipIf(!infraAvailable)(
    'generate with no relevant context returns empty citations gracefully',
    async () => {
      const res = await requireApp().inject({
        method: 'POST',
        url: '/generate',
        payload: {
          query: 'nonexistent query that matches nothing xyz',
          topK: 1,
          documentId: '00000000-0000-4000-8000-000000000099',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.citations)).toBe(true);
      expect(body.citations.length).toBe(0);
      expect(typeof body.answer).toBe('string');
      expect(body.answer).toContain('could not find');
    },
  );

  test.skipIf(!infraAvailable)('rejects invalid generate payloads with 400', async () => {
    const emptyQuery = await requireApp().inject({
      method: 'POST',
      url: '/generate',
      payload: { query: '' },
    });
    expect(emptyQuery.statusCode).toBe(400);
    expect(emptyQuery.json().code).toBe('VALIDATION_ERROR');

    const zeroTopK = await requireApp().inject({
      method: 'POST',
      url: '/generate',
      payload: { query: 'hello', topK: 0 },
    });
    expect(zeroTopK.statusCode).toBe(400);

    const missingQuery = await requireApp().inject({
      method: 'POST',
      url: '/generate',
      payload: { topK: 5 },
    });
    expect(missingQuery.statusCode).toBe(400);
  });
});

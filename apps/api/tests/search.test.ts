import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { searchRequestSchema } from '../src/schemas/search-schemas';

const infraAvailable = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe('search schemas', () => {
  test('searchRequestSchema validates query and topK', () => {
    expect(searchRequestSchema.safeParse({ query: '' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ query: 'hello' }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ query: 'hello', topK: 0 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ query: 'hello', topK: 101 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ query: 'hello', topK: 5 }).success).toBe(true);
  });
});

describe('search API', () => {
  let app: FastifyInstance | undefined;
  const createdIds: string[] = [];

  function requireApp(): FastifyInstance {
    if (!app) throw new Error('search test app not initialized');
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

  test.skipIf(!infraAvailable)('ingest -> search roundtrip returns ranked results', async () => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filenameA = `search-a-${uniq}.md`;
    const filenameB = `search-b-${uniq}.md`;
    // Short docs -> single chunk each (default chunkSize 512). Include uniq in content to avoid cross-run collisions
    const contentA = `# Doc A ${uniq}\n\nThe quick brown fox jumps over the lazy dog ${uniq}`;
    const contentB = `# Doc B ${uniq}\n\nCar engine repair manual for vehicles and maintenance ${uniq}`;

    const uploadA = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename: filenameA, content: contentA },
    });
    expect(uploadA.statusCode).toBe(201);
    const docA = uploadA.json();
    createdIds.push(docA.id);

    const uploadB = await requireApp().inject({
      method: 'POST',
      url: '/documents',
      payload: { filename: filenameB, content: contentB },
    });
    expect(uploadB.statusCode).toBe(201);
    const docB = uploadB.json();
    createdIds.push(docB.id);

    // Both docs should be ready (inline processing in test env)
    expect(docA.status).toBe('ready');
    expect(docB.status).toBe('ready');

    // Fetch chunks to get exact chunk content for deterministic exact-match assertion
    const chunksA = await requireApp().inject({
      method: 'GET',
      url: `/documents/${docA.id}/chunks`,
    });
    expect(chunksA.statusCode).toBe(200);
    const chunkAContent = chunksA.json().chunks[0].content as string;
    expect(typeof chunkAContent).toBe('string');

    // Exact chunk content query should yield that chunk top-ranked with score 1 (cosine similarity for normalized identical vectors)
    const searchExact = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: chunkAContent, topK: 5 },
    });
    expect(searchExact.statusCode).toBe(200);
    const bodyExact = searchExact.json();
    expect(bodyExact.query).toBe(chunkAContent);
    expect(Array.isArray(bodyExact.results)).toBe(true);
    expect(bodyExact.results.length).toBeGreaterThanOrEqual(1);
    // Top result is the exact chunk with score ≈1
    expect(bodyExact.results[0].chunkId).toBe(chunksA.json().chunks[0].id);
    expect(bodyExact.results[0].score).toBeCloseTo(1, 5);
    // Each result has required fields and valid score range -1..1
    for (const hit of bodyExact.results) {
      expect(typeof hit.chunkId).toBe('string');
      expect(typeof hit.documentId).toBe('string');
      expect(typeof hit.content).toBe('string');
      expect(typeof hit.score).toBe('number');
      expect(hit.score).toBeGreaterThanOrEqual(-1.01);
      expect(hit.score).toBeLessThanOrEqual(1.01);
      expect(typeof hit.metadata).toBe('object');
    }

    // topK limiting
    const searchTop1 = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: chunkAContent, topK: 1 },
    });
    expect(searchTop1.statusCode).toBe(200);
    expect(searchTop1.json().results.length).toBe(1);
    expect(searchTop1.json().results[0].chunkId).toBe(chunksA.json().chunks[0].id);

    // Document filter: only hits from that document
    const searchFiltered = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: chunkAContent, topK: 5, documentId: docA.id },
    });
    expect(searchFiltered.statusCode).toBe(200);
    for (const hit of searchFiltered.json().results) {
      expect(hit.documentId).toBe(docA.id);
    }

    // Default topK (no topK param) should still return results
    const searchDefault = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: chunkAContent },
    });
    expect(searchDefault.statusCode).toBe(200);
    expect(searchDefault.json().results.length).toBeGreaterThanOrEqual(1);
  });

  test.skipIf(!infraAvailable)('rejects invalid search payloads with 400', async () => {
    const emptyQuery = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: '' },
    });
    expect(emptyQuery.statusCode).toBe(400);
    expect(emptyQuery.json().code).toBe('VALIDATION_ERROR');

    const zeroTopK = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello', topK: 0 },
    });
    expect(zeroTopK.statusCode).toBe(400);

    const tooLargeTopK = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'hello', topK: 101 },
    });
    expect(tooLargeTopK.statusCode).toBe(400);

    const missingQuery = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { topK: 5 },
    });
    expect(missingQuery.statusCode).toBe(400);
  });

  test.skipIf(!infraAvailable)('returns empty array when no chunks match yet', async () => {
    // Use a brand-new query against filtered documentId that doesn't exist -> empty? But we can't create empty doc; instead filter to non-existent document
    // Create a search with a non-existent documentId that is valid UUID -> should return 0 results (no chunks for that doc)
    const nonExistentDocId = '00000000-0000-4000-8000-000000000099';
    const res = await requireApp().inject({
      method: 'POST',
      url: '/search',
      payload: { query: 'anything', topK: 5, documentId: nonExistentDocId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});

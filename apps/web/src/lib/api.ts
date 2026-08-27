const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000';

export interface DocumentView {
  id: string;
  filename: string;
  contentType: string;
  status: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  version: {
    id: string;
    version: number;
    contentHash: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    content?: string;
    metadata?: Record<string, unknown>;
  } | null;
}

export interface ChunkView {
  id: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionJobView {
  id: string;
  documentId: string;
  documentVersionId: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SearchHit {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
}

export interface GenerateResult {
  query: string;
  answer: string;
  citations: SearchHit[];
  retrievedCount: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const j = JSON.parse(body) as { error?: string; code?: string };
      message = j.error ?? j.code ?? body;
    } catch {}
    throw new Error(`${res.status} ${res.statusText}: ${message}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    request<{ status: string; checks: Record<string, { ok: boolean; latencyMs?: number }> }>(
      '/health',
    ),
  listDocuments: (limit = 20, offset = 0) =>
    request<{ items: DocumentView[]; total: number; limit: number; offset: number }>(
      `/documents?limit=${limit}&offset=${offset}`,
    ),
  getDocument: (id: string) => request<DocumentView>(`/documents/${id}`),
  getChunks: (id: string) =>
    request<{ documentId: string; chunks: ChunkView[] }>(`/documents/${id}/chunks`),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  uploadDocument: (input: { filename: string; content: string; contentType?: string }) =>
    request<
      DocumentView & { ingestionJob?: IngestionJobView } & { jobId?: string } & {
        job?: IngestionJobView;
      }
    >('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reindex: (id: string, content: string) =>
    request<{ document: DocumentView; version: unknown; ingestionJob: IngestionJobView }>(
      `/documents/${id}/reindex`,
      { method: 'POST', body: JSON.stringify({ content }) },
    ),
  getJob: (id: string) => request<IngestionJobView>(`/jobs/${id}`),
  search: (query: string, topK = 5, documentId?: string) =>
    request<SearchResult>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, topK, ...(documentId ? { documentId } : {}) }),
    }),
  generate: (query: string, topK = 5, documentId?: string, systemPrompt?: string) =>
    request<GenerateResult>('/generate', {
      method: 'POST',
      body: JSON.stringify({
        query,
        topK,
        ...(documentId ? { documentId } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
      }),
    }),
};

export function getApiUrl(): string {
  return API_URL;
}

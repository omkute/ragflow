const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function parseApiError(status: number, statusText: string, raw: string): ApiError {
  let body: { error?: string; code?: string } = {};
  try {
    body = JSON.parse(raw) as { error?: string; code?: string };
  } catch {
    // Keep plain-text server failures readable.
  }
  return new ApiError(status, body.code ?? 'REQUEST_FAILED', body.error ?? (raw || statusText));
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.message.toLowerCase().includes('aborted');
}

export interface DocumentView {
  id: string;
  source: string;
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

export interface HealthResult {
  status: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
}
export interface AISettings {
  embeddingProvider: 'fake' | 'openai' | 'gemini' | 'openai-compatible';
  embeddingModel: string;
  embeddingConfigured: boolean;
  llmProvider: 'fake' | 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';
  llmModel: string;
  llmConfigured: boolean;
  embeddingBaseUrl?: string;
  llmBaseUrl?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new ApiError(
      0,
      'API_UNREACHABLE',
      error instanceof Error ? error.message : 'API is unreachable',
    );
  }
  if (!res.ok) {
    const raw = await res.text();
    throw parseApiError(res.status, res.statusText, raw);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const params = (values: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) search.set(key, String(value));
  const value = search.toString();
  return value ? `?${value}` : '';
};

export const api = {
  health: (signal?: AbortSignal) => request<HealthResult>('/health', { signal }),
  getAISettings: () => request<AISettings>('/settings/ai'),
  updateAISettings: (input: {
    embeddingProvider?: AISettings['embeddingProvider'];
    embeddingModel?: string;
    embeddingApiKey?: string;
    embeddingBaseUrl?: string;
    llmProvider?: AISettings['llmProvider'];
    llmModel?: string;
    llmApiKey?: string;
    llmBaseUrl?: string;
  }) => request<AISettings>('/settings/ai', { method: 'PUT', body: JSON.stringify(input) }),
  listDocuments: (limit = 25, offset = 0, signal?: AbortSignal) =>
    request<{ items: DocumentView[]; total: number; limit: number; offset: number }>(
      `/documents${params({ limit, offset })}`,
      { signal },
    ),
  getDocument: (id: string, signal?: AbortSignal) =>
    request<DocumentView>(`/documents/${id}`, { signal }),
  getChunks: (id: string, signal?: AbortSignal) =>
    request<{ documentId: string; chunks: ChunkView[] }>(`/documents/${id}/chunks`, { signal }),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),
  uploadDocument: (input: { filename: string; content: string; contentType?: string }) =>
    request<
      DocumentView & { jobId: string; job: Pick<IngestionJobView, 'id' | 'status' | 'attempts'> }
    >('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reindex: (id: string, content: string) =>
    request<
      DocumentView & { jobId: string; job: Pick<IngestionJobView, 'id' | 'status' | 'attempts'> }
    >(`/documents/${id}/reindex`, { method: 'POST', body: JSON.stringify({ content }) }),
  getJob: (id: string, signal?: AbortSignal) =>
    request<IngestionJobView>(`/jobs/${id}`, { signal }),
  listJobs: (limit = 25, offset = 0, status?: string, signal?: AbortSignal) =>
    request<{ items: IngestionJobView[]; total: number; limit: number; offset: number }>(
      `/jobs${params({ limit, offset, status })}`,
      { signal },
    ),
  search: (query: string, topK = 5, documentId?: string, signal?: AbortSignal) =>
    request<SearchResult>('/search', {
      signal,
      method: 'POST',
      body: JSON.stringify({ query, topK, ...(documentId ? { documentId } : {}) }),
    }),
  generate: (
    query: string,
    topK = 5,
    documentId?: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ) =>
    request<GenerateResult>('/generate', {
      signal,
      method: 'POST',
      body: JSON.stringify({
        query,
        topK,
        ...(documentId ? { documentId } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
      }),
    }),
};

export async function waitForJob(
  jobId: string,
  options: { signal?: AbortSignal; intervalMs?: number; maxPolls?: number } = {},
): Promise<IngestionJobView> {
  const intervalMs = options.intervalMs ?? 700;
  const maxPolls = options.maxPolls ?? 45;
  let job = await api.getJob(jobId, options.signal);
  for (let poll = 0; poll < maxPolls && ['queued', 'processing'].includes(job.status); poll += 1) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });
    job = await api.getJob(jobId, options.signal);
  }
  return job;
}

export function getApiUrl(): string {
  return API_URL;
}

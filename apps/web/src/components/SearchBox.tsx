'use client';
import { type SearchHit, api } from '@/lib/api';
import { useState } from 'react';

export function SearchBox() {
  const [query, setQuery] = useState('How does chunking work?');
  const [topK, setTopK] = useState(5);
  const [documentId, setDocumentId] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) {
      setError('Query is required');
      return;
    }
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await api.search(query, topK, documentId || undefined);
      setResults(res.results);
      setLatency(Math.round((performance.now() - t0) * 10) / 10);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">Search</h3>
      <p className="mb-2 text-[11px] text-zinc-500">
        POST /search — pgvector cosine (1 = exact). Validated topK 1-100.
      </p>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="query"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <button
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          topK
          <input
            type="number"
            min={1}
            max={100}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value) || 5)}
            className="w-16 rounded border px-2 py-1"
          />
        </label>
        <input
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          placeholder="documentId filter (optional)"
          className="flex-1 rounded border px-2 py-1 font-mono text-[11px]"
        />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {latency !== null && (
        <p className="mt-1 text-[11px] text-zinc-400">
          {results.length} hits · {latency}ms
        </p>
      )}
      <div className="mt-3 space-y-2">
        {results.map((h) => (
          <div key={h.chunkId} className="rounded-lg border bg-zinc-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="font-mono">{h.chunkId.slice(0, 8)}</span>
              <span className="rounded bg-white px-1.5 py-0.5">score {h.score.toFixed(3)}</span>
              <span className="truncate font-mono">{h.documentId.slice(0, 8)}</span>
              {typeof h.metadata.heading === 'string' && h.metadata.heading && (
                <span className="rounded bg-white px-1.5 py-0.5">{h.metadata.heading}</span>
              )}
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-zinc-800">
              {h.content}
            </p>
          </div>
        ))}
        {!loading && results.length === 0 && !error && (
          <p className="text-xs text-zinc-400">
            No hits yet. Try an exact chunk content for score 1.
          </p>
        )}
      </div>
    </div>
  );
}

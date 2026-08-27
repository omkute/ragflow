'use client';
import { type GenerateResult, api } from '@/lib/api';
import { useState } from 'react';

export function GenerateBox() {
  const [query, setQuery] = useState('How does incremental indexing work?');
  const [topK, setTopK] = useState(5);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) {
      setError('Query is required');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.generate(query, topK, undefined, systemPrompt || undefined);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">Generate (RAG)</h3>
      <p className="mb-2 text-[11px] text-zinc-500">
        POST /generate — separate from /search, returns answer + citations. Never invents sources.
      </p>
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={2}
        placeholder="Question"
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <label className="flex items-center gap-1 text-xs">
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
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="systemPrompt (optional)"
          className="flex-1 rounded border px-2 py-1 text-xs"
        />
        <button
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '…' : 'Generate'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border bg-emerald-50 p-3">
            <p className="text-xs font-medium text-emerald-900">Answer</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800">
              {result.answer}
            </p>
            <p className="mt-2 text-[11px] text-zinc-500">
              via {result.retrievedCount} chunk(s) — which documents were used is in citations below
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-700">Citations</p>
            {result.citations.length === 0 ? (
              <p className="text-xs text-zinc-400">No citations — no relevant chunks found.</p>
            ) : (
              <div className="space-y-2">
                {result.citations.map((c, idx) => (
                  <div key={c.chunkId} className="rounded-lg border bg-zinc-50 p-3">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span>[{idx + 1}]</span>
                      <span className="font-mono">{c.chunkId.slice(0, 8)}</span>
                      <span>score {c.score.toFixed(3)}</span>
                      <span className="truncate font-mono">{c.documentId.slice(0, 8)}</span>
                      {typeof c.metadata.heading === 'string' && c.metadata.heading && (
                        <span className="rounded bg-white px-1.5 py-0.5">{c.metadata.heading}</span>
                      )}
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-zinc-800">
                      {c.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

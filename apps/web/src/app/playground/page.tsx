'use client';
import { PageHeader } from '@/components/page-header';
import {
  Button,
  CodeValue,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { type DocumentView, type GenerateResult, type SearchResult, api } from '@/lib/api';
import { FlaskConical, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type PlaygroundResult = (SearchResult | GenerateResult) & { _latency: number };
export default function Playground() {
  const [mode, setMode] = useState<'retrieve' | 'generate'>('retrieve');
  const [query, setQuery] = useState('How does incremental indexing reuse embeddings?');
  const [topK, setTopK] = useState(5);
  const [docId, setDocId] = useState('');
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [system, setSystem] = useState('');
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .listDocuments(100)
      .then((r) => setDocs(r.items))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', mode);
    url.searchParams.set('q', query);
    window.history.replaceState({}, '', url);
  }, [mode, query]);
  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const out =
        mode === 'retrieve'
          ? await api.search(query, topK, docId || undefined)
          : await api.generate(query, topK, docId || undefined, system || undefined);
      setResult({ ...out, _latency: Math.round(performance.now() - start) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <PageHeader
        eyebrow="Experiment"
        title="Playground"
        description="Inspect retrieval behavior and grounded generation against your current index."
      />
      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <section className="h-fit border border-border p-5">
          <div className="mb-5 flex border-b border-border">
            <button
              onClick={() => {
                setMode('retrieve');
                setResult(null);
                setError(null);
              }}
              className={`flex-1 border-b-2 pb-3 text-sm ${mode === 'retrieve' ? 'border-accent text-accent' : 'border-transparent text-muted'}`}
            >
              <Search size={15} className="mr-2 inline" />
              Retrieve
            </button>
            <button
              onClick={() => {
                setMode('generate');
                setResult(null);
                setError(null);
              }}
              className={`flex-1 border-b-2 pb-3 text-sm ${mode === 'generate' ? 'border-accent text-accent' : 'border-transparent text-muted'}`}
            >
              <FlaskConical size={15} className="mr-2 inline" />
              Generate
            </button>
          </div>
          <label className="text-xs font-medium">
            {mode === 'retrieve' ? 'Query' : 'Question'}
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run();
              }}
              rows={6}
              className="mt-2"
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs font-medium">
              Top K
              <Select
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="mt-2 w-full"
              >
                <option>3</option>
                <option>5</option>
                <option>10</option>
                <option>20</option>
              </Select>
            </label>
            <label className="text-xs font-medium">
              Document
              <Select
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                className="mt-2 w-full"
              >
                <option value="">All documents</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {mode === 'generate' && (
            <details className="mt-4">
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <SlidersHorizontal size={14} />
                Advanced settings
              </summary>
              <label className="mt-3 block text-xs text-muted">
                Optional system prompt
                <Textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  rows={4}
                  className="mt-2"
                  placeholder="Answer with only grounded context…"
                />
              </label>
            </details>
          )}
          <Button
            onClick={() => void run()}
            disabled={loading || !query.trim()}
            className="mt-5 w-full bg-accent text-accent-foreground hover:opacity-90"
          >
            {loading && <Spinner />}
            {loading ? 'Running…' : mode === 'retrieve' ? 'Run retrieval' : 'Generate answer'}
            <span className="ml-auto font-mono text-[10px] opacity-70">⌘↵</span>
          </Button>
        </section>
        <section>
          {error ? (
            <ErrorState message={error} onRetry={() => void run()} />
          ) : !result ? (
            <EmptyState
              title="No request yet"
              description="Run a retrieval or generation request to inspect ranked chunks and citations."
              icon={Search}
            />
          ) : (
            <Results mode={mode} result={result} />
          )}
        </section>
      </div>
    </>
  );
}
function Results({ mode, result }: { mode: 'retrieve' | 'generate'; result: PlaygroundResult }) {
  const hits =
    mode === 'retrieve' && 'results' in result
      ? result.results
      : 'citations' in result
        ? result.citations
        : [];
  return (
    <div>
      <div className="mb-4 flex items-center justify-between text-xs text-muted">
        <span>
          {mode === 'retrieve'
            ? `${hits.length} ranked results`
            : `${(result as GenerateResult).retrievedCount} retrieved chunks`}
        </span>
        <span className="font-mono">{result._latency} ms</span>
      </div>
      {mode === 'generate' && (
        <div className="mb-6 border border-border bg-muted/30 p-5">
          <p className="mb-3 text-xs uppercase tracking-wide text-accent">Grounded answer</p>
          <p className="whitespace-pre-wrap text-sm leading-7">
            {'answer' in result ? result.answer : 'No generated answer returned.'}
          </p>
        </div>
      )}
      <div className="space-y-2">
        {hits.length ? (
          hits.map((h, i) => (
            <div key={h.chunkId} className="border border-border p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-mono text-accent">
                  {mode === 'generate' ? `[${i + 1}]` : `#${i + 1}`}
                </span>
                <span>score {h.score.toFixed(3)}</span>
                <span>chunk {h.chunkIndex}</span>
                {typeof h.metadata.heading === 'string' && (
                  <span className="rounded bg-muted px-2 py-0.5">{h.metadata.heading}</span>
                )}
                <CodeValue copy={h.chunkId}>{h.chunkId.slice(0, 12)}…</CodeValue>
              </div>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-muted">
                {h.content}
              </pre>
              {mode === 'generate' && (
                <Link
                  className="mt-3 inline-block text-xs text-accent"
                  href={`/documents/${h.documentId}?tab=chunks`}
                >
                  Open source document →
                </Link>
              )}
            </div>
          ))
        ) : (
          <EmptyState
            title="No context found"
            description="The query returned no indexed chunks. Check that the document is ready."
          />
        )}
      </div>
    </div>
  );
}

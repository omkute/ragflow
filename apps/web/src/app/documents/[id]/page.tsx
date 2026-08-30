'use client';
import { PageHeader } from '@/components/page-header';
import {
  Button,
  CodeValue,
  CopyButton,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Spinner,
  StatusBadge,
  Textarea,
  Timestamp,
} from '@/components/ui';
import { type ChunkView, type DocumentView, api, isAbortError, waitForJob } from '@/lib/api';
import { ArrowLeft, FileText, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [chunks, setChunks] = useState<ChunkView[]>([]);
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([api.getDocument(id, c.signal), api.getChunks(id, c.signal)])
      .then(([d, cx]) => {
        setDoc(d);
        setChunks(cx.chunks);
      })
      .catch((e) => !isAbortError(e) && setError(e instanceof Error ? e.message : String(e)));
    return () => c.abort();
  }, [id]);
  if (error) return <ErrorState message={error} />;
  if (!doc)
    return (
      <div className="space-y-4">
        <LoadingSkeleton className="h-10" />
        <LoadingSkeleton className="h-64" />
      </div>
    );
  const filtered = chunks.filter((c) =>
    `${c.content} ${c.metadata.heading ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  const reindex = async () => {
    if (!doc.version?.content) {
      setError('This document has no loaded content to reindex.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice('Creating a new version…');
    try {
      const out = await api.reindex(id, doc.version.content);
      const job = await waitForJob(out.jobId);
      if (job.status === 'completed') {
        setNotice(`Version ${out.currentVersion} is ready.`);
        location.reload();
      } else if (job.status === 'failed') {
        throw new Error(job.error ?? 'Reindexing failed');
      } else {
        setNotice('Reindexing is still running. Follow it from Jobs.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotice(null);
    } finally {
      setBusy(false);
    }
  };
  const deleteDocument = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteDocument(id);
      router.push('/documents');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirm(false);
      setBusy(false);
    }
  };
  return (
    <>
      <Link
        href="/documents"
        className="mb-5 inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={15} />
        Back to documents
      </Link>
      <PageHeader
        title={doc.filename}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <StatusBadge status={doc.status} />
            <CodeValue copy={doc.id}>{doc.id}</CodeValue>
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void reindex()} className="border border-border">
              {busy ? <Spinner /> : <RefreshCw size={15} />}
              {busy ? 'Reindexing…' : 'Reindex'}
            </Button>
            <Button
              onClick={() => setConfirm(true)}
              className="border border-red-500/30 text-red-600"
            >
              <Trash2 size={15} />
              Delete
            </Button>
          </div>
        }
      />
      {notice && (
        <p className="mb-5 border border-accent/30 bg-accent/5 p-3 text-sm text-accent">{notice}</p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-4 flex gap-5 border-b border-border text-sm">
            {['overview', 'content', 'chunks', 'metadata'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b-2 px-1 pb-3 capitalize ${tab === t ? 'border-accent text-accent' : 'border-transparent text-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'overview' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Document ID', <CodeValue copy={doc.id}>{doc.id}</CodeValue>],
                [
                  'Content hash',
                  doc.version ? (
                    <CodeValue copy={doc.version.contentHash}>{doc.version.contentHash}</CodeValue>
                  ) : (
                    '—'
                  ),
                ],
                ['Version', <span className="font-mono">v{doc.currentVersion}</span>],
                ['Created', <Timestamp value={doc.createdAt} />],
                ['Updated', <Timestamp value={doc.updatedAt} />],
                ['Ingestion', <StatusBadge status={doc.version?.status ?? doc.status} />],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-border p-4">
                  <p className="text-xs text-muted">{label}</p>
                  <div className="mt-2 text-sm">{value}</div>
                </div>
              ))}
            </div>
          )}
          {tab === 'content' && (
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap border border-border bg-muted/30 p-5 font-mono text-xs leading-6">
              {doc.version?.content ?? 'Content is not available until the version is loaded.'}
            </pre>
          )}
          {tab === 'metadata' && (
            <pre className="border border-border bg-muted/30 p-5 font-mono text-xs">
              {JSON.stringify(doc.version?.metadata ?? {}, null, 2)}
            </pre>
          )}
          {tab === 'chunks' && (
            <div>
              <Input
                aria-label="Search chunks"
                placeholder="Search chunk content or heading…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="mt-4 space-y-2">
                {filtered.length ? (
                  filtered.map((c) => <Chunk key={c.id} chunk={c} />)
                ) : (
                  <EmptyState
                    title="No chunks available"
                    description={
                      chunks.length
                        ? 'No chunks match your search.'
                        : 'Indexing may still be in progress.'
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>
        <aside className="h-fit border border-border p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Current version</p>
          <p className="mt-2 font-mono text-lg">v{doc.currentVersion}</p>
          <div className="mt-5 space-y-3 text-sm text-muted">
            <p>{chunks.length} indexed chunks</p>
            <p>{doc.contentType}</p>
            <p>Source: {doc.source}</p>
          </div>
        </aside>
      </div>
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
        >
          <div className="max-w-md rounded-lg border border-border bg-background p-6">
            <h2 className="font-semibold">Delete document?</h2>
            <p className="mt-2 text-sm text-muted">
              All versions, chunks, and associated jobs will also be deleted.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setConfirm(false)} className="border border-border">
                Cancel
              </Button>
              <Button
                onClick={() => void deleteDocument()}
                disabled={busy}
                className="bg-red-600 text-white"
              >
                Delete document
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function Chunk({ chunk: c }: { chunk: ChunkView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"
      >
        <span className="font-mono text-xs text-accent">#{c.chunkIndex}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {typeof c.metadata.heading === 'string' ? c.metadata.heading : 'Untitled chunk'}
        </span>
        <span className="font-mono text-xs text-muted">{c.tokenCount} tokens</span>
        <span className="font-mono text-xs text-muted">{c.contentHash.slice(0, 8)}…</span>
      </button>
      {open && (
        <div className="border-t border-border p-4">
          <div className="mb-3 flex justify-end gap-1">
            <CopyButton label="Copy chunk ID" value={c.id} />
            <CopyButton label="Copy chunk content" value={c.content} />
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-muted">
            {c.content}
          </pre>
        </div>
      )}
    </div>
  );
}

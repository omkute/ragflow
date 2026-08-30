'use client';
import { PageHeader } from '@/components/page-header';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
  Timestamp,
} from '@/components/ui';
import { UploadDialog } from '@/components/upload-dialog';
import { type DocumentView, type HealthResult, api } from '@/lib/api';
import { ArrowUpRight, FileText, Layers3, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export default function Overview() {
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [total, setTotal] = useState(0);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState(false);
  const load = () => {
    setError(null);
    Promise.all([api.listDocuments(5, 0), api.health()])
      .then(([d, h]) => {
        setDocs(d.items);
        setTotal(d.total);
        setHealth(h);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(() => {
    load();
  }, []);
  const counts = docs.reduce(
    (a, d) => {
      a[d.status] = (a[d.status] ?? 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );
  return (
    <>
      <PageHeader
        eyebrow="Pipeline overview"
        title="Operational overview"
        description="A compact view of your document index, ingestion pipeline, and retrieval dependencies."
        action={
          <Button
            onClick={() => setUpload(true)}
            className="bg-accent text-accent-foreground hover:opacity-90"
          >
            <Upload size={16} />
            Upload document
          </Button>
        }
      />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          <section className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-background p-5">
              <p className="text-xs text-muted">Documents</p>
              <p className="mt-2 text-2xl font-semibold">{total}</p>
              <p className="mt-1 text-xs text-muted">logical source documents</p>
            </div>
            {['ready', 'processing', 'pending'].map((s) => (
              <div key={s} className="bg-background p-5">
                <p className="text-xs capitalize text-muted">{s}</p>
                <p className="mt-2 text-2xl font-semibold">{counts[s] ?? '—'}</p>
                <p className="mt-1 text-xs text-muted">visible on first page</p>
              </div>
            ))}
          </section>
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.45fr_1fr]">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Recent documents</h2>
                  <p className="mt-1 text-sm text-muted">Latest sources entering the index.</p>
                </div>
                <Link href="/documents" className="flex items-center gap-1 text-sm text-accent">
                  View all <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="border border-border">
                {docs.length ? (
                  docs.map((d) => (
                    <Link
                      href={`/documents/${d.id}`}
                      key={d.id}
                      className="flex items-center gap-4 border-b border-border p-4 last:border-0 hover:bg-muted/40"
                    >
                      <FileText size={17} className="shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{d.filename}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted">
                          v{d.currentVersion} · {d.contentType}
                        </p>
                      </div>
                      <StatusBadge status={d.status} />
                      <Timestamp value={d.updatedAt} />
                    </Link>
                  ))
                ) : (
                  <EmptyState title="No documents" description="Upload a source to see it here." />
                )}
              </div>
            </section>
            <section>
              <div className="mb-3">
                <h2 className="font-semibold">Services</h2>
                <p className="mt-1 text-sm text-muted">Readiness from GET /health.</p>
              </div>
              <div className="divide-y divide-border border border-border">
                {health ? (
                  Object.entries(health.checks).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`health-dot ${value.status === 'ok' ? 'health-ok' : 'health-down'}`}
                        />
                        <span className="text-sm capitalize">{key}</span>
                      </div>
                      <span className="font-mono text-xs text-muted">
                        {value.latencyMs ? `${value.latencyMs} ms` : value.status}
                      </span>
                    </div>
                  ))
                ) : (
                  <LoadingSkeleton className="h-52" />
                )}
              </div>
            </section>
          </div>
          <section className="mt-8 border border-border p-5">
            <div className="flex items-center gap-2">
              <Layers3 size={17} className="text-accent" />
              <h2 className="font-semibold">Incremental indexing pipeline</h2>
            </div>
            <div className="mt-5 grid gap-2 text-xs sm:grid-cols-6">
              {['Upload', 'Normalize', 'Chunk', 'Embed / reuse', 'Index', 'Retrieve'].map(
                (step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    <div className="flex-1 border border-border bg-muted/40 px-3 py-3 font-mono">
                      {String(i + 1).padStart(2, '0')}
                      <span className="ml-2 font-sans text-foreground">{step}</span>
                    </div>
                    {i < 5 && <span className="hidden text-muted sm:block">→</span>}
                  </div>
                ),
              )}
            </div>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">
              When a document changes, Ragflow compares deterministic chunk hashes with the previous
              version and reuses embeddings for unchanged chunks. Only new or changed chunks go back
              through the embedding provider.
            </p>
          </section>
        </>
      )}
      <UploadDialog open={upload} onClose={() => setUpload(false)} onComplete={load} />
    </>
  );
}

'use client';
import { PageHeader } from '@/components/page-header';
import { Button, EmptyState, ErrorState, Select, StatusBadge, Timestamp } from '@/components/ui';
import { type IngestionJobView, api } from '@/lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export default function Jobs() {
  const [items, setItems] = useState<IngestionJobView[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api
      .listJobs(25, offset, status || undefined)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        items.some((j) => ['queued', 'processing'].includes(j.status))
      )
        load();
    }, 5000);
    return () => clearInterval(id);
  }, [offset, status]);
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Ingestion jobs"
        description="Lifecycle state, retries, and failure details for asynchronous indexing work."
      />
      <div className="mb-4 flex justify-end">
        <Select
          aria-label="Filter jobs by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No ingestion jobs"
          description="Upload a document to create an observable indexing job."
        />
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted">
              <tr>
                {['Job', 'Document', 'Status', 'Attempts', 'Created', 'Started', 'Completed'].map(
                  (h) => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id} className="border-t border-border hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/jobs/${j.id}`} className="font-mono text-xs text-accent">
                      {j.id.slice(0, 12)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/documents/${j.documentId}`}
                      className="font-mono text-xs hover:text-accent"
                    >
                      {j.documentId.slice(0, 12)}…
                    </Link>
                    <p className="text-[11px] text-muted">
                      version {j.documentVersionId.slice(0, 8)}…
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{j.attempts}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    <Timestamp value={j.createdAt} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    <Timestamp value={j.startedAt} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    <Timestamp value={j.completedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button
          disabled={!offset}
          onClick={() => setOffset(offset - 25)}
          className="border border-border"
        >
          Previous
        </Button>
        <Button
          disabled={offset + 25 >= total}
          onClick={() => setOffset(offset + 25)}
          className="border border-border"
        >
          Next
        </Button>
      </div>
    </>
  );
}

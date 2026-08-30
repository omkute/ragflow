'use client';
import { type DocumentView, api, isAbortError } from '@/lib/api';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Select,
  StatusBadge,
  Timestamp,
} from './ui';
export function DocumentTable({
  refresh = 0,
  onUpload,
}: { refresh?: number; onUpload?: () => void }) {
  const [items, setItems] = useState<DocumentView[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<DocumentView | null>(null);
  const load = () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    api
      .listDocuments(25, offset, controller.signal)
      .then((r) => {
        setError(null);
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!isAbortError(e)) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  };
  useEffect(() => load(), [offset, refresh]);
  const filtered = items.filter(
    (d) =>
      (status === 'all' || d.status === status) &&
      d.filename.toLowerCase().includes(query.toLowerCase()),
  );
  const del = async () => {
    if (!remove) return;
    try {
      await api.deleteDocument(remove.id);
      setRemove(null);
      load();
      onUpload?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input
          aria-label="Search documents"
          placeholder="Search filenames…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          aria-label="Filter document status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </Select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} className="h-14" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query || status !== 'all' ? 'No matching documents' : 'No documents yet'}
          description={
            query || status !== 'all'
              ? 'Try changing your filters.'
              : 'Upload a Markdown or text file to create your first indexed document.'
          }
        />
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted">
              <tr>
                {['Filename', 'Status', 'Type', 'Version', 'Updated', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-muted/40">
                  <td className="max-w-[300px] px-4 py-3">
                    <Link
                      href={`/documents/${d.id}`}
                      className="block truncate font-medium hover:text-accent"
                    >
                      {d.filename}
                    </Link>
                    <span className="font-mono text-[11px] text-muted">{d.id.slice(0, 13)}…</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {d.contentType.replace('text/', '')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">v{d.currentVersion}</td>
                  <td className="px-4 py-3 text-muted">
                    <Timestamp value={d.updatedAt} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      aria-label={`Delete ${d.filename}`}
                      title="Delete document"
                      onClick={() => setRemove(d)}
                      className="rounded p-2 text-muted hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>
          {total === 0
            ? 'No documents'
            : `${offset + 1}–${Math.min(offset + 25, total)} of ${total}`}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
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
      </div>
      {remove && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-2xl">
            <h2 className="font-semibold">Delete {remove.filename}?</h2>
            <p className="mt-2 text-sm text-muted">
              This permanently deletes all versions, chunks, and associated ingestion jobs.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setRemove(null)} className="border border-border">
                Cancel
              </Button>
              <Button onClick={() => void del()} className="bg-red-600 text-white hover:bg-red-700">
                Delete document
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

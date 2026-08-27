'use client';
import { type DocumentView, api } from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  refreshKey: number;
  onSelect: (doc: DocumentView) => void;
  onRefresh: () => void;
}

export function DocumentList({ refreshKey, onSelect, onRefresh }: Props) {
  const [items, setItems] = useState<DocumentView[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDocuments(limit, offset);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void fetchList();
  }, [fetchList, refreshKey]);

  const del = async (id: string) => {
    if (!confirm('Delete document? Cascades versions/chunks/jobs.')) return;
    try {
      await api.deleteDocument(id);
      await fetchList();
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">Documents</h3>
        <span className="text-xs text-zinc-500">
          {total} total · offset {offset}
        </span>
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="max-h-[380px] overflow-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">filename</th>
              <th className="px-3 py-2 font-medium">status</th>
              <th className="px-3 py-2 font-medium">ver</th>
              <th className="px-3 py-2 font-medium">actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  No documents yet. Upload .md/.txt above.
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr
                  key={d.id}
                  className="cursor-pointer border-t hover:bg-zinc-50"
                  onClick={() => onSelect(d)}
                >
                  <td className="max-w-[220px] truncate px-3 py-2 font-medium text-zinc-800">
                    {d.filename}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        d.status === 'ready'
                          ? 'bg-emerald-100 text-emerald-700'
                          : d.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : d.status === 'processing'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{d.currentVersion}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void del(d.id);
                      }}
                      className="rounded px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <button
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
          className="rounded-md border px-3 py-1 text-xs disabled:opacity-40"
        >
          Prev
        </button>
        <button onClick={() => void fetchList()} className="rounded-md border px-3 py-1 text-xs">
          Refresh
        </button>
        <button
          disabled={offset + limit >= total}
          onClick={() => setOffset((o) => o + limit)}
          className="rounded-md border px-3 py-1 text-xs disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

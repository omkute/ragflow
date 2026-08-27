'use client';
import { type ChunkView as Chunk, type DocumentView, api } from '@/lib/api';
import { useEffect, useState } from 'react';

export function ChunkView({
  doc,
  onClose,
}: {
  doc: DocumentView | null;
  onClose: () => void;
}) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentView | null>(null);

  useEffect(() => {
    if (!doc) return;
    const docId = doc.id;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [d, c] = await Promise.all([api.getDocument(docId), api.getChunks(docId)]);
        if (!cancelled) {
          setDetail(d);
          setChunks(c.chunks);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  if (!doc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{doc.filename}</h3>
            <p className="text-xs text-zinc-500">
              {doc.id} · {chunks.length} chunks · version {doc.currentVersion} · {doc.status}
            </p>
            {detail?.version?.contentHash && (
              <p className="text-[11px] text-zinc-400">
                contentHash {detail.version.contentHash.slice(0, 12)}…
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md border px-3 py-1 text-xs">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-xs text-zinc-400">Loading…</p>
          ) : error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : chunks.length === 0 ? (
            <p className="text-xs text-zinc-400">No chunks (document not yet indexed).</p>
          ) : (
            <div className="space-y-3">
              {chunks.map((c) => (
                <div key={c.id} className="rounded-lg border bg-zinc-50 p-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="font-mono">#{c.chunkIndex}</span>
                    <span>{c.tokenCount} tokens</span>
                    <span className="font-mono">{c.contentHash.slice(0, 8)}</span>
                    {typeof c.metadata.heading === 'string' && c.metadata.heading && (
                      <span className="rounded bg-white px-1.5 py-0.5">
                        {String(c.metadata.heading)}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-800">
                    {c.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

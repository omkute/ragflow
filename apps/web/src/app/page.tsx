'use client';
import { ChunkView } from '@/components/ChunkView';
import { DocumentList } from '@/components/DocumentList';
import { GenerateBox } from '@/components/GenerateBox';
import { HealthBadge } from '@/components/HealthBadge';
import { SearchBox } from '@/components/SearchBox';
import { UploadDropzone } from '@/components/UploadDropzone';
import type { DocumentView } from '@/lib/api';
import { useState } from 'react';

export default function Page() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<DocumentView | null>(null);

  return (
    <main className="mx-auto max-w-[1280px] p-4 md:p-6">
      <header className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Indexa — Incremental RAG</h1>
          <p className="text-xs text-zinc-500">
            Deterministic chunking · SHA-256 hashing · incremental embedding reuse · pgvector ·
            BullMQ
          </p>
        </div>
        <HealthBadge />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <UploadDropzone onUploaded={() => setRefreshKey((k) => k + 1)} />
          <DocumentList
            refreshKey={refreshKey}
            onSelect={(doc) => setSelected(doc)}
            onRefresh={() => setRefreshKey((k) => k + 1)}
          />
        </div>
        <div className="space-y-4">
          <SearchBox />
          <GenerateBox />
        </div>
      </div>

      <footer className="mt-8 text-center text-[11px] text-zinc-400">
        API {process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000'} · Docs: POST /documents,
        GET /documents?limit&offset, GET /documents/:id, GET /documents/:id/chunks, POST
        /documents/:id/reindex, GET /jobs/:id, DELETE /documents/:id, POST /search, POST /generate,
        GET /health
      </footer>

      {selected && <ChunkView doc={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

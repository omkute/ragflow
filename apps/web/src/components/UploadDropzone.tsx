'use client';
import { api } from '@/lib/api';
import { useCallback, useState } from 'react';

interface Props {
  onUploaded: () => void;
}

export function UploadDropzone({ onUploaded }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      if (
        !file.name.endsWith('.md') &&
        !file.name.endsWith('.txt') &&
        file.name !== 'evaluation test'
      ) {
        // allow .md/.txt per DocumentService; show warning but still try (server will 415)
      }
      setBusy(true);
      setStatus(`Uploading ${file.name}…`);
      try {
        const content = await file.text();
        const res = await api.uploadDocument({ filename: file.name, content });
        // res contains ingestionJob when async; in test env it's already completed
        const jobId =
          (res as unknown as { ingestionJob?: { id: string }; jobId?: string })?.ingestionJob?.id ??
          (res as unknown as { jobId?: string })?.jobId;
        if (jobId) {
          setStatus(`Queued ${file.name} → job ${jobId.slice(0, 8)}…`);
          // poll job
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 800));
            try {
              const job = await api.getJob(jobId);
              setStatus(`${file.name}: ${job.status} (${job.attempts} attempts)`);
              if (job.status === 'completed') {
                setStatus(`✓ ${file.name} ready`);
                break;
              }
              if (job.status === 'failed') {
                setStatus(`✗ ${file.name} failed: ${job.error ?? 'unknown'}`);
                break;
              }
            } catch {}
          }
        } else {
          setStatus(`✓ ${file.name} uploaded`);
        }
        onUploaded();
      } catch (e) {
        setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
        setTimeout(() => setStatus(null), 4000);
      }
    },
    [onUploaded],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0);
      for (const f of files) void uploadFile(f);
    },
    [uploadFile],
  );

  const onInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      for (const f of files) void uploadFile(f);
      e.target.value = '';
    },
    [uploadFile],
  );

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold text-zinc-800">Upload</h3>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition ${
          dragOver ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-zinc-50/50'
        }`}
      >
        <p className="text-sm text-zinc-600">Drag .md / .txt here</p>
        <p className="text-xs text-zinc-400">or</p>
        <label className="mt-2 cursor-pointer rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800">
          Browse files
          <input
            type="file"
            multiple
            accept=".md,.txt,text/markdown,text/plain"
            className="hidden"
            onChange={onInput}
            disabled={busy}
          />
        </label>
        {busy && <p className="mt-2 text-xs text-zinc-500">Uploading…</p>}
      </div>
      {status && <p className="mt-2 text-xs text-zinc-600">{status}</p>}
      <p className="mt-2 text-[11px] text-zinc-400">
        Supported: Markdown, TXT. Content is normalized, chunked (512/50), hashed SHA-256, embedded
        via pgvector.
      </p>
    </div>
  );
}

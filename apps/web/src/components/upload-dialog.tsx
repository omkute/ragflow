'use client';
import { api, isAbortError, waitForJob } from '@/lib/api';
import { isSupportedDocument } from '@/lib/validation';
import { FileUp, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spinner } from './ui';
export function UploadDialog({
  open,
  onClose,
  onComplete,
}: { open: boolean; onClose: () => void; onComplete: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setMessage(null);
      setProgress(null);
      requestController.current?.abort();
    }
  }, [open]);
  const add = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    const invalid = next.filter((f) => !isSupportedDocument(f.name));
    if (invalid.length) {
      setMessage(
        `Unsupported file${invalid.length > 1 ? 's' : ''}: ${invalid.map((f) => f.name).join(', ')}`,
      );
    }
    setFiles(next.filter((f) => isSupportedDocument(f.name) && f.size > 0));
  };
  const upload = useCallback(async () => {
    if (!files.length) return;
    setBusy(true);
    const controller = new AbortController();
    requestController.current = controller;
    setMessage(null);
    let failures = 0;
    for (const file of files) {
      try {
        const content = await file.text();
        const out = await api.uploadDocument({ filename: file.name, content });
        setProgress(`${file.name}: waiting for ingestion`);
        const job = await waitForJob(out.jobId, { signal: controller.signal });
        if (job.status === 'failed')
          throw new Error(`${file.name}: ${job.error ?? 'ingestion failed'}`);
        if (['queued', 'processing'].includes(job.status))
          throw new Error(`${file.name}: ingestion timed out; inspect its job for details`);
      } catch (error) {
        if (isAbortError(error)) return;
        failures++;
        setMessage(error instanceof Error ? error.message : 'Upload failed');
      }
    }
    setBusy(false);
    requestController.current = null;
    onComplete();
    if (!failures) onClose();
  }, [files, onClose, onComplete]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 id="upload-title" className="font-semibold">
              Upload documents
            </h2>
            <p className="mt-1 text-sm text-muted">Ragflow accepts Markdown and plain text files.</p>
          </div>
          <button
            aria-label="Close upload dialog"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-muted"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
            onClick={() => input.current?.click()}
            className="cursor-pointer border border-dashed border-border p-8 text-center hover:border-accent"
          >
            <UploadCloud className="mx-auto mb-3 text-accent" size={25} />
            <p className="text-sm font-medium">Drop .md or .txt files here</p>
            <p className="mt-1 text-xs text-muted">or choose files from your computer</p>
            <input
              ref={input}
              type="file"
              multiple
              accept=".md,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => e.target.files && add(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              {files.map((f) => (
                <div key={f.name} className="flex items-center gap-2 text-sm">
                  <FileUp size={15} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {Math.ceil(f.size / 1024)} KB
                  </span>
                </div>
              ))}
            </div>
          )}
          {progress && <p className="mt-4 text-sm text-muted">{progress}</p>}
          {message && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-5">
          <Button onClick={onClose} className="text-muted hover:bg-muted">
            Cancel
          </Button>
          <Button
            disabled={!files.length || busy}
            onClick={() => void upload()}
            className="bg-accent text-accent-foreground hover:opacity-90"
          >
            {busy && <Spinner />}
            {busy ? 'Indexing…' : 'Start indexing'}
          </Button>
        </div>
      </div>
    </div>
  );
}

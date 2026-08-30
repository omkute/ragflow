'use client';
import { PageHeader } from '@/components/page-header';
import { CodeValue, ErrorState, LoadingSkeleton, StatusBadge, Timestamp } from '@/components/ui';
import { type IngestionJobView, api } from '@/lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<IngestionJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .getJob(id)
        .then((j) => alive && setJob(j))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    load();
    const timer = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        job &&
        ['queued', 'processing'].includes(job.status)
      )
        load();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, job?.status]);
  if (error) return <ErrorState message={error} />;
  if (!job) return <LoadingSkeleton className="h-64" />;
  return (
    <>
      <Link href="/jobs" className="text-sm text-muted">
        ← Back to jobs
      </Link>
      <PageHeader
        eyebrow="Job detail"
        title="Ingestion lifecycle"
        description={
          <span className="flex items-center gap-3">
            <CodeValue copy={job.id}>{job.id}</CodeValue>
            <StatusBadge status={job.status} />
          </span>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          [
            'Document',
            <Link className="font-mono text-xs text-accent" href={`/documents/${job.documentId}`}>
              {job.documentId}
            </Link>,
          ],
          ['Version', <CodeValue copy={job.documentVersionId}>{job.documentVersionId}</CodeValue>],
          ['Attempts', <span className="font-mono">{job.attempts}</span>],
          ['Created', <Timestamp value={job.createdAt} />],
          ['Started', <Timestamp value={job.startedAt} />],
          ['Completed', <Timestamp value={job.completedAt} />],
        ].map(([l, v]) => (
          <div key={String(l)} className="border border-border p-5">
            <p className="text-xs text-muted">{l}</p>
            <div className="mt-2 break-words text-sm">{v}</div>
          </div>
        ))}
      </div>
      {job.error && (
        <div className="mt-6 border border-red-500/30 bg-red-500/5 p-5">
          <p className="text-xs uppercase tracking-wide text-red-600">Error</p>
          <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-red-700 dark:text-red-300">
            {job.error}
          </pre>
        </div>
      )}
    </>
  );
}

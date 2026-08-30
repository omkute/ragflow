'use client';
import { Check, Copy, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

export function Button({
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 ${props.className ?? ''}`}
    />
  );
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 ${props.className ?? ''}`}
    />
  );
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${props.className ?? ''}`}
    />
  );
}
export function CopyButton({ value, label = 'Copy value' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted hover:bg-muted/60 hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ['ready', 'completed'].includes(status)
    ? 'status-ready'
    : ['failed', 'cancelled'].includes(status)
      ? 'status-failed'
      : ['processing', 'queued', 'pending'].includes(status)
        ? 'status-warn'
        : 'status-neutral';
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}
export function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}
export function EmptyState({
  title,
  description,
  icon: Icon = TriangleAlert,
}: { title: string; description: string; icon?: typeof TriangleAlert }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-border px-6 text-center">
      <Icon size={22} className="mb-3 text-muted" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <TriangleAlert size={17} className="mt-0.5 text-red-500" />
        <div>
          <p className="font-medium text-red-700 dark:text-red-300">Request failed</p>
          <p className="mt-1 break-words text-red-700/80 dark:text-red-300/80">{message}</p>
          {onRetry && (
            <Button
              onClick={onRetry}
              className="mt-3 border border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-300"
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
export function CodeValue({ children, copy }: { children: React.ReactNode; copy?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-muted">
      <span className="truncate">{children}</span>
      {copy && <CopyButton value={copy} />}
    </span>
  );
}
export function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <time dateTime={value} title={new Date(value).toLocaleString()}>
      {new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}
    </time>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="animate-spin" aria-label="Loading" />;
}

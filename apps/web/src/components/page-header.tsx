export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: { eyebrow?: string; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-accent">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

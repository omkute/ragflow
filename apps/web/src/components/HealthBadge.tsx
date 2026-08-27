'use client';
import { api, getApiUrl } from '@/lib/api';
import { useEffect, useState } from 'react';

export function HealthBadge() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'degraded' | 'error'>('loading');
  const [latencies, setLatencies] = useState<Record<string, number>>({});
  const [url] = useState(getApiUrl());

  async function check() {
    try {
      const res = await api.health();
      const ok = res.status === 'ok';
      setStatus(ok ? 'ok' : 'degraded');
      const l: Record<string, number> = {};
      for (const [k, v] of Object.entries(res.checks)) {
        if (typeof v.latencyMs === 'number') l[k] = v.latencyMs;
      }
      setLatencies(l);
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const color =
    status === 'ok'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : status === 'degraded'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : status === 'loading'
          ? 'bg-zinc-100 text-zinc-600 border-zinc-200'
          : 'bg-red-100 text-red-800 border-red-200';

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${color}`}
    >
      <span className="h-2 w-2 rounded-full bg-current opacity-60" />
      {status === 'loading'
        ? 'checking…'
        : status === 'ok'
          ? 'API ok'
          : status === 'degraded'
            ? 'degraded'
            : 'API unreachable'}
      <span className="opacity-60">{url}</span>
      {Object.keys(latencies).length > 0 && (
        <span className="hidden sm:inline opacity-60">
          {Object.entries(latencies)
            .map(([k, v]) => `${k} ${v}ms`)
            .join(' · ')}
        </span>
      )}
    </div>
  );
}

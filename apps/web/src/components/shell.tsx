'use client';
import { api } from '@/lib/api';
import {
  Activity,
  Beaker,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  Menu,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { ThemeProvider, useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from './ui';

const nav = [
  ['Overview', '/', Home],
  ['Documents', '/documents', FileText],
  ['Playground', '/playground', Beaker],
  ['Jobs', '/jobs', BriefcaseBusiness],
  ['Evaluation', '/evaluation', Activity],
  ['Settings', '/settings', Settings],
] as const;
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-1">
      <button
        aria-label="Use light theme"
        onClick={() => setTheme('light')}
        className={`rounded p-1.5 ${theme === 'light' ? 'bg-muted' : ''}`}
      >
        <Sun size={14} />
      </button>
      <button
        aria-label="Use dark theme"
        onClick={() => setTheme('dark')}
        className={`rounded p-1.5 ${theme === 'dark' ? 'bg-muted' : ''}`}
      >
        <Moon size={14} />
      </button>
    </div>
  );
}
function Health() {
  const [state, setState] = useState<'checking' | 'ok' | 'degraded' | 'down'>('checking');
  useEffect(() => {
    let alive = true;
    const run = () =>
      api
        .health()
        .then((x) => alive && setState(x.status === 'ok' ? 'ok' : 'degraded'))
        .catch(() => alive && setState('down'));
    run();
    const id = setInterval(run, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className={`health-dot health-${state}`} />
      <span>
        {state === 'ok'
          ? 'All systems operational'
          : state === 'checking'
            ? 'Checking services…'
            : state === 'degraded'
              ? 'API degraded'
              : 'API unreachable'}
      </span>
    </div>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={`${mobile ? 'fixed inset-0 z-40 flex' : 'hidden'} ${collapsed ? 'w-[72px]' : 'w-60'} shrink-0 flex-col border-r border-border bg-sidebar md:sticky md:top-0 md:flex md:h-screen`}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-foreground">
              i
            </span>
            {!collapsed && <span>indexa</span>}
          </Link>
          {mobile ? (
            <button aria-label="Close navigation" onClick={() => setMobile(false)}>
              <X size={18} />
            </button>
          ) : (
            <button
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setCollapsed(!collapsed)}
              className="hidden rounded p-1 text-muted hover:bg-muted md:block"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          )}
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map(([label, href, Icon]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobile(false)}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${pathname === href || (href !== '/' && pathname.startsWith(href)) ? 'bg-muted font-medium' : 'text-muted hover:bg-muted/70 hover:text-foreground'}`}
            >
              <Icon size={17} />
              {!collapsed && label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <Health />
          {!collapsed && (
            <p className="mt-2 font-mono text-[10px] text-muted">LOCAL / SELF-HOSTED</p>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
              className="rounded p-1 text-muted md:hidden"
            >
              <Menu size={19} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted md:flex">
              <span>Indexa</span>
              <span>/</span>
              <span className="text-foreground">
                {nav.find(([, href]) =>
                  href === '/' ? pathname === '/' : pathname.startsWith(href),
                )?.[0] ?? 'Console'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Health />
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

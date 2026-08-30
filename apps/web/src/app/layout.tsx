import type { Metadata } from 'next';
import './globals.css';
import { AppShell, Providers } from '@/components/shell';

export const metadata: Metadata = {
  title: 'Ragflow — Incremental RAG',
  description: 'Incremental RAG indexing & retrieval dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

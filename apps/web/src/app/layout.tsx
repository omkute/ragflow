import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Indexa — Incremental RAG',
  description: 'Incremental RAG indexing & retrieval dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

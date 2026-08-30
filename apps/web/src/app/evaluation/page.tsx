import { PageHeader } from '@/components/page-header';
import { BookOpen, Terminal } from 'lucide-react';
export default function Evaluation() {
  return (
    <>
      <PageHeader
        eyebrow="Quality"
        title="Evaluation"
        description="Retrieval quality belongs beside the index, but this console only displays results that are actually persisted."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border border-border p-6">
          <BookOpen size={18} className="text-accent" />
          <h2 className="mt-4 font-semibold">Benchmark dataset</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            The repository includes six retrieval cases across authentication, chunking, embeddings,
            incremental reuse, and pgvector search.
          </p>
          <p className="mt-5 font-mono text-xs text-muted">evaluation/datasets/retrieval.json</p>
          <p className="mt-5 text-sm text-muted">
            Stored benchmark artifacts are available under{' '}
            <span className="font-mono">evaluation/benchmarks/</span>. This page does not turn
            historical artifacts into live production metrics.
          </p>
        </section>
        <section className="border border-border p-6">
          <Terminal size={18} className="text-accent" />
          <h2 className="mt-4 font-semibold">Run locally</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            The runner ingests missing dataset documents inline, queries the same SearchService used
            by the API, computes Recall@K, Precision@K, MRR, nDCG, and latency, then writes a JSON
            artifact.
          </p>
          <pre className="mt-5 overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-6">
            bun run evaluate{`\n`}bun run evaluate -- --topK 10{`\n`}CHUNK_SIZE=256 CHUNK_OVERLAP=32
            bun run evaluate
          </pre>
        </section>
      </div>
      <section className="mt-6 border border-dashed border-border p-6">
        <p className="text-sm font-medium">No live evaluation results endpoint</p>
        <p className="mt-2 text-sm text-muted">
          Scores are intentionally not shown as current system health. Add a read-only benchmark API
          when evaluation artifacts need to be browsed inside the console.
        </p>
      </section>
    </>
  );
}

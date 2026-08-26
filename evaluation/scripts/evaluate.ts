#!/usr/bin/env bun
/**
 * Retrieval evaluation runner — Milestone 9.
 *
 * Loads `evaluation/datasets/retrieval.json`, ensures the referenced
 * documents are ingested (reading from `evaluation/datasets/documents/`),
 * runs each query through the same pgvector search pipeline, and computes
 * Recall@K, Precision@K, MRR, nDCG@K and latency.
 *
 * Usage:
 *   bun run evaluate
 *   bun evaluation/scripts/evaluate.ts --topK 5 --dataset evaluation/datasets/retrieval.json
 *   CHUNK_SIZE=256 CHUNK_OVERLAP=32 bun run evaluate
 *
 * Dataset format:
 *   [{ id, question, query, expectedDocuments: ["authentication.md"], topK? }]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDb } from '@indexa/db';
import { documents } from '@indexa/db';
import { FakeEmbeddingProvider } from '@indexa/embeddings';
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRank } from '@indexa/evaluation';
import type { EvaluationCase } from '@indexa/evaluation';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../../apps/api/src/config';
import { createSearchRepository } from '../../apps/api/src/repositories/search-repository';
import { DocumentService } from '../../apps/api/src/services/document-service';
import { SearchService } from '../../apps/api/src/services/search-service';

interface CliOptions {
  dataset: string;
  topK: number;
  ingest: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let dataset = 'evaluation/datasets/retrieval.json';
  let topK: number | undefined;
  let ingest = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dataset' && args[i + 1]) {
      dataset = args[i + 1] as string;
      i++;
    } else if (arg === '--topK' && args[i + 1]) {
      topK = Number.parseInt(args[i + 1] as string, 10);
      i++;
    } else if (arg === '--no-ingest') {
      ingest = false;
    }
  }

  return { dataset, topK: topK ?? 5, ingest };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const config = loadConfig();

  const datasetPath = resolve(options.dataset);
  const raw = await readFile(datasetPath, 'utf8');
  const cases: EvaluationCase[] = JSON.parse(raw) as EvaluationCase[];

  if (!Array.isArray(cases) || cases.length === 0) {
    console.error(`Dataset at ${datasetPath} is empty or invalid`);
    process.exit(1);
  }

  const { db, sql } = createDb(config.DATABASE_URL);
  const embeddingProvider = new FakeEmbeddingProvider({
    dimension: config.VECTOR_DIMENSION,
  });
  const searchRepository = createSearchRepository(db);
  const searchService = new SearchService({
    embeddingProvider,
    searchRepository,
  });

  // Ensure referenced documents are ingested when --ingest (default)
  // Uses inline processing so the script is self-contained without a worker.
  if (options.ingest) {
    const uniqueFilenames = [...new Set(cases.flatMap((c) => c.expectedDocuments))];
    const documentService = new DocumentService(db, {
      chunkerConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
      embeddingProvider,
      processInline: true,
    });

    for (const filename of uniqueFilenames) {
      const existing = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.filename, filename))
        .limit(1);
      if (existing.length > 0) continue;

      const docPath = resolve(`evaluation/datasets/documents/${filename}`);
      let content: string;
      try {
        content = await readFile(docPath, 'utf8');
      } catch {
        console.warn(
          `Expected document file not found: ${docPath} — skipping ingest for ${filename}`,
        );
        continue;
      }
      console.log(`Ingesting ${filename} for evaluation...`);
      try {
        await documentService.create({ filename, content });
      } catch (error) {
        console.warn(
          `Failed to ingest ${filename}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // Build filename -> documentId map for relevance checks
  const filenameToId = new Map<string, string>();
  const allDocs = await db
    .select({ id: documents.id, filename: documents.filename })
    .from(documents);
  for (const row of allDocs) {
    filenameToId.set(row.filename, row.id);
  }

  // Also map documentId -> filename for retrieved hits (join)
  const idToFilename = new Map<string, string>();
  for (const [filename, id] of filenameToId.entries()) {
    idToFilename.set(id, filename);
  }

  const results: Array<{
    caseId: string;
    query: string;
    expectedDocuments: string[];
    topK: number;
    retrievedFilenames: string[];
    retrievedCount: number;
    recallAtK: number;
    precisionAtK: number;
    reciprocalRank: number;
    ndcgAtK: number;
    latencyMs: number;
  }> = [];

  let totalRecall = 0;
  let totalPrecision = 0;
  let totalRR = 0;
  let totalNdcg = 0;
  const latencies: number[] = [];

  for (const c of cases) {
    const k = c.topK ?? options.topK;
    const start = performance.now();
    let retrievedFilenames: string[] = [];
    let retrievedCount = 0;

    try {
      const out = await searchService.search({ query: c.query, topK: k });
      retrievedCount = out.results.length;
      retrievedFilenames = out.results.map(
        (hit) => idToFilename.get(hit.documentId) ?? hit.documentId,
      );
    } catch (error) {
      console.warn(
        `Search failed for case ${c.id}:`,
        error instanceof Error ? error.message : error,
      );
    }

    const latencyMs = performance.now() - start;
    latencies.push(latencyMs);

    const recall = recallAtK(retrievedFilenames, c.expectedDocuments, k);
    const precision = precisionAtK(retrievedFilenames, c.expectedDocuments, k);
    const rr = reciprocalRank(retrievedFilenames, c.expectedDocuments);
    const ndcg = ndcgAtK(retrievedFilenames, c.expectedDocuments, k);

    totalRecall += recall;
    totalPrecision += precision;
    totalRR += rr;
    totalNdcg += ndcg;

    results.push({
      caseId: c.id,
      query: c.query,
      expectedDocuments: c.expectedDocuments,
      topK: k,
      retrievedFilenames: retrievedFilenames.slice(0, k),
      retrievedCount,
      recallAtK: recall,
      precisionAtK: precision,
      reciprocalRank: rr,
      ndcgAtK: ndcg,
      latencyMs: Math.round(latencyMs * 100) / 100,
    });
  }

  const count = cases.length;
  const avgRecall = totalRecall / count;
  const avgPrecision = totalPrecision / count;
  const mrr = totalRR / count;
  const avgNdcg = totalNdcg / count;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const sortedLat = [...latencies].sort((a, b) => a - b);
  const p50 = sortedLat[Math.floor(sortedLat.length * 0.5)] ?? 0;
  const p95 = sortedLat[Math.floor(sortedLat.length * 0.95)] ?? 0;

  const summary = {
    dataset: options.dataset,
    count,
    topK: options.topK,
    chunkConfig: { chunkSize: config.CHUNK_SIZE, chunkOverlap: config.CHUNK_OVERLAP },
    vectorDimension: config.VECTOR_DIMENSION,
    metrics: {
      recallAtK: Math.round(avgRecall * 10000) / 10000,
      precisionAtK: Math.round(avgPrecision * 10000) / 10000,
      mrr: Math.round(mrr * 10000) / 10000,
      ndcgAtK: Math.round(avgNdcg * 10000) / 10000,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      p50LatencyMs: Math.round(p50 * 100) / 100,
      p95LatencyMs: Math.round(p95 * 100) / 100,
    },
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  // Write benchmark artifact for chunking experiments
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir('evaluation/benchmarks', { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = `evaluation/benchmarks/${stamp}-k${options.topK}-c${config.CHUNK_SIZE}o${config.CHUNK_OVERLAP}.json`;
    await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.error(`Benchmark written to ${outPath}`);
  } catch {
    // Non-fatal: benchmarks directory is gitignored in CI
  }

  await sql.end();

  // Exit code 0 even if recall is low; CI can gate on thresholds via jq if needed
  if (avgRecall < 0.5) {
    console.error(
      `Warning: Recall@${options.topK} is ${avgRecall.toFixed(4)} — check chunking or dataset coverage`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

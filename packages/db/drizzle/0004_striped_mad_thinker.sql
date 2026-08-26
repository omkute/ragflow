DROP INDEX "ingestion_jobs_document_version_id_idx";--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_jobs_document_version_id_uq" ON "ingestion_jobs" USING btree ("document_version_id");
CREATE TYPE "public"."ingestion_job_status" AS ENUM('queued', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"status" "ingestion_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_jobs_document_id_idx" ON "ingestion_jobs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_document_version_id_idx" ON "ingestion_jobs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_status_idx" ON "ingestion_jobs" USING btree ("status");
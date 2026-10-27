CREATE TYPE "public"."catalog_import_status" AS ENUM('pending', 'running', 'ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."catalog_source_kind" AS ENUM('web', 'mercadolibre', 'instagram');--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source_id" uuid,
	"external_key" text,
	"title" text NOT NULL,
	"description" text,
	"price" integer,
	"currency" text,
	"operation" text,
	"location" text,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"available" boolean DEFAULT true NOT NULL,
	"edited_manually" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "catalog_source_kind" DEFAULT 'web' NOT NULL,
	"url" text NOT NULL,
	"status" "catalog_import_status" DEFAULT 'pending' NOT NULL,
	"last_imported_at" timestamp with time zone,
	"last_error" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_source_id_catalog_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."catalog_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD CONSTRAINT "catalog_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_business_id_source_id_external_key_index" ON "catalog_items" USING btree ("business_id","source_id","external_key");--> statement-breakpoint
CREATE INDEX "catalog_items_business_id_available_index" ON "catalog_items" USING btree ("business_id","available");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_sources_business_id_url_index" ON "catalog_sources" USING btree ("business_id","url");
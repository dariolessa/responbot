ALTER TABLE "catalog_sources" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD COLUMN "access_token_enc" text;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "catalog_sources" ADD COLUMN "token_expires_at" timestamp with time zone;
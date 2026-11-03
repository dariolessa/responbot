CREATE TYPE "public"."sync_status" AS ENUM('requested', 'in_progress', 'done', 'declined', 'failed');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "human_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "from_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "coexistence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "coexistence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "contacts_sync" "sync_status";--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "history_sync" "sync_status";--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "history_progress" integer;
ALTER TABLE "bot_settings" ADD COLUMN "reactivation_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_settings" ADD COLUMN "review_request_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_settings" ADD COLUMN "review_url" text;--> statement-breakpoint
ALTER TABLE "bot_settings" ADD COLUMN "review_delay_hours" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payment_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "last_receipt_invoice_id" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "rebook_interval_days" integer;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD COLUMN "alerts_sent" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");
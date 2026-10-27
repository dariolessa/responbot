ALTER TYPE "public"."scheduled_kind" ADD VALUE 'booking_confirmation';--> statement-breakpoint
ALTER TYPE "public"."scheduled_kind" ADD VALUE 'booking_cancelled';--> statement-breakpoint
DROP INDEX "notifications_business_id_index";--> statement-breakpoint
ALTER TABLE "booking_rules" ADD COLUMN "reminder_first_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "booking_rules" ADD COLUMN "reminder_second_hours" integer DEFAULT 2;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "daily_summary_sent_on" date;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "weekly_summary_sent_on" date;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lifecycle_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_e164" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_business_id_created_at_index" ON "notifications" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduled_messages_booking_id_index" ON "scheduled_messages" USING btree ("booking_id");
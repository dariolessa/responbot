ALTER TYPE "public"."scheduled_kind" ADD VALUE 'deposit_request';--> statement-breakpoint
ALTER TYPE "public"."scheduled_kind" ADD VALUE 'hold_expired';--> statement-breakpoint
ALTER TYPE "public"."scheduled_kind" ADD VALUE 'deposit_refunded';--> statement-breakpoint
ALTER TYPE "public"."scheduled_kind" ADD VALUE 'waitlist_taken';--> statement-breakpoint
ALTER TABLE "booking_rules" ADD COLUMN "no_show_deposit_threshold" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_preference_id" text;--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD COLUMN "live_mode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_error" text;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "waitlist_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offered_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offered_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offer_source_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "booked_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_waitlist_entry_id_waitlist_entries_id_fk" FOREIGN KEY ("waitlist_entry_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_offered_resource_id_resources_id_fk" FOREIGN KEY ("offered_resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_offer_source_booking_id_bookings_id_fk" FOREIGN KEY ("offer_source_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booked_booking_id_bookings_id_fk" FOREIGN KEY ("booked_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_refund_status_index" ON "payments" USING btree ("refund_status");--> statement-breakpoint
ALTER TABLE "mp_accounts" ADD CONSTRAINT "mp_accounts_mp_user_id_unique" UNIQUE("mp_user_id");
ALTER TABLE "conversations" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_message_preview" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "choices" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "verified_name" text;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "pin_enc" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_business_id_last_message_at_index" ON "conversations" USING btree ("business_id","last_message_at");--> statement-breakpoint
-- A mano: las conversaciones que ya existen (chat de prueba) toman la fecha y el texto de su último mensaje.
UPDATE "conversations" c SET "last_message_at" = m."created_at", "last_message_preview" = left(coalesce(m."transcript", m."body"), 120)
FROM (SELECT DISTINCT ON ("conversation_id") "conversation_id", "created_at", "body", "transcript" FROM "messages" ORDER BY "conversation_id", "created_at" DESC) m
WHERE m."conversation_id" = c."id";

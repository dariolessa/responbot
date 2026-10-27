ALTER TABLE "businesses" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "onboarding_completed" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
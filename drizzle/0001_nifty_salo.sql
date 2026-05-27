CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "companies" ("slug", "name", "website") VALUES ('memorygram', 'Memorygram', 'https://memorygram.com') ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
DROP INDEX "reviews_status_idx";--> statement-breakpoint
DROP INDEX "reviews_reviewed_at_idx";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_review_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_url" text;--> statement-breakpoint
UPDATE "reviews" SET "company_id" = (SELECT "id" FROM "companies" WHERE "slug" = 'memorygram') WHERE "company_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_company_status_reviewed_idx" ON "reviews" USING btree ("company_id","status","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_source_dedupe_idx" ON "reviews" USING btree ("company_id","source","source_review_id");
CREATE TYPE "public"."source_kind" AS ENUM('mock', 'reddit', 'rss', 'trustpilot', 'google', 'yelp');--> statement-breakpoint
CREATE TABLE "review_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"kind" "source_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"include_keywords" text[] DEFAULT '{}' NOT NULL,
	"exclude_keywords" text[] DEFAULT '{}' NOT NULL,
	"min_rating" integer,
	"max_rating" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_rating_range";--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_sources" ADD CONSTRAINT "review_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_sources_company_idx" ON "review_sources" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" is null or "reviews"."rating" between 1 and 5);
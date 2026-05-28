ALTER TABLE "reviews" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "sort_order" integer;--> statement-breakpoint
CREATE INDEX "reviews_company_status_sort_idx" ON "reviews" USING btree ("company_id","status","sort_order");
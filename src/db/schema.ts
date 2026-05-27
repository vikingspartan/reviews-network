import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/** Moderation state for a review. */
export const reviewStatus = pgEnum("review_status", [
	"published",
	"pending",
	"hidden",
]);

/** Kinds of source a company's reviews can be ingested from. */
export const sourceKind = pgEnum("source_kind", [
	"mock",
	"reddit",
	"rss",
	"trustpilot",
	"google",
	"yelp",
]);

/**
 * A target company whose reviews we aggregate. Each frontend site is dedicated
 * to one company (selected by hostname); reviews are tenanted by `company_id`.
 */
export const companies = pgTable("companies", {
	id: serial("id").primaryKey(),
	/** Stable key referenced by site config (e.g. "memorygram"). */
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	/** The company's own website (linked from the review site). */
	website: text("website"),
	logoUrl: text("logo_url"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * A configured source to ingest a company's reviews from, with the selective
 * filters applied at ingestion time (keywords + rating range).
 */
export const reviewSources = pgTable(
	"review_sources",
	{
		id: serial("id").primaryKey(),
		companyId: integer("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		kind: sourceKind("kind").notNull(),
		/** Source-specific config, e.g. { subreddit, query } / { placeId } / { businessUnitId }. */
		config: jsonb("config")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		/** Keep a review only if its text contains one of these (case-insensitive). Empty = no keyword gate. */
		includeKeywords: text("include_keywords").array().notNull().default([]),
		/** Drop a review if its text contains any of these. */
		excludeKeywords: text("exclude_keywords").array().notNull().default([]),
		/** Drop reviews below this rating (unrated reviews are dropped when set). */
		minRating: integer("min_rating"),
		/** Drop reviews above this rating. */
		maxRating: integer("max_rating"),
		enabled: boolean("enabled").notNull().default(true),
		lastRunAt: timestamp("last_run_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("review_sources_company_idx").on(t.companyId)],
);

/** Reviews of a company, aggregated from one or more sources. */
export const reviews = pgTable(
	"reviews",
	{
		id: serial("id").primaryKey(),
		/** The company this review is about. */
		companyId: integer("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		/** Display name of the reviewer. */
		authorName: text("author_name").notNull(),
		/** Optional "City, Country" string shown alongside the name. */
		authorLocation: text("author_location"),
		/** Star rating, 1-5. NULL for unrated sources (e.g. Reddit mentions). */
		rating: integer("rating"),
		/** Optional short headline. */
		title: text("title"),
		/** The review text. */
		body: text("body").notNull(),
		/** Product/line the review is about, if known. */
		product: text("product"),
		/** Where the review came from: "website", "trustpilot", "google", "reddit", etc. */
		source: text("source").notNull().default("website"),
		/** External id from the source platform; used to de-duplicate on re-import. */
		sourceReviewId: text("source_review_id"),
		/** Link to the original review on the source platform. */
		sourceUrl: text("source_url"),
		/** Whether the reviewer is a verified purchaser. */
		verified: boolean("verified").notNull().default(false),
		/** Moderation status; only "published" reviews are shown publicly. */
		status: reviewStatus("status").notNull().default("published"),
		/** When the review was written by the customer. */
		reviewedAt: timestamp("reviewed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// Primary access pattern: a company's published reviews, newest first.
		index("reviews_company_status_reviewed_idx").on(
			t.companyId,
			t.status,
			t.reviewedAt,
		),
		index("reviews_rating_idx").on(t.rating),
		check(
			"reviews_rating_range",
			sql`${t.rating} is null or ${t.rating} between 1 and 5`,
		),
		// Idempotent ingestion: the same source review can't be inserted twice.
		// (NULL source_review_id rows are allowed to repeat — e.g. manual/CSV imports.)
		uniqueIndex("reviews_source_dedupe_idx").on(
			t.companyId,
			t.source,
			t.sourceReviewId,
		),
	],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type ReviewSource = typeof reviewSources.$inferSelect;
export type NewReviewSource = typeof reviewSources.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

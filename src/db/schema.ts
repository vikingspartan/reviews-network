import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/** Moderation state for a review. */
export const reviewStatus = pgEnum("review_status", [
	"published",
	"pending",
	"hidden",
]);

/** Customer reviews of Memorygram products. */
export const reviews = pgTable(
	"reviews",
	{
		id: serial("id").primaryKey(),
		/** Display name of the reviewer. */
		authorName: text("author_name").notNull(),
		/** Optional "City, Country" string shown alongside the name. */
		authorLocation: text("author_location"),
		/** Star rating, 1-5 (enforced by a check constraint). */
		rating: integer("rating").notNull(),
		/** Optional short headline. */
		title: text("title"),
		/** The review text. */
		body: text("body").notNull(),
		/** Which Memorygram product the review is about, if known. */
		product: text("product"),
		/** Where the review came from: "website", "trustpilot", "google", etc. */
		source: text("source").notNull().default("website"),
		/** Whether the reviewer is a verified purchaser. */
		verified: boolean("verified").notNull().default(false),
		/** Moderation status; only "published" reviews should be shown publicly. */
		status: reviewStatus("status").notNull().default("published"),
		/** When the review was written by the customer. */
		reviewedAt: timestamp("reviewed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** When the row was inserted. */
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** When the row was last updated. */
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("reviews_status_idx").on(t.status),
		index("reviews_rating_idx").on(t.rating),
		index("reviews_reviewed_at_idx").on(t.reviewedAt),
		check("reviews_rating_range", sql`${t.rating} between 1 and 5`),
	],
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

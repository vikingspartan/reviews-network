import { and, count, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "./index";
import { type Company, type Review, companies, reviews } from "./schema";

/**
 * Display order shared by every public listing: hand-ranked reviews first
 * (lowest `sort_order`), then unranked reviews newest-first. Set the rank by
 * drag-and-drop in the admin.
 */
const displayOrder = [sql`${reviews.sortOrder} asc nulls last`, desc(reviews.reviewedAt)];

/** Display switches applied when fetching a company's reviews. */
export interface ReviewFilter {
	/** Only include reviews from these sources (e.g. ["google", "trustpilot"]). */
	sources?: string[];
	/** Hide reviews below this star rating (drops unrated reviews too). */
	minRating?: number;
	/** Cap the number of reviews returned. */
	limit?: number;
}

/** Look up a company by its slug (the key used in site config). */
export async function getCompanyBySlug(
	db: Database,
	slug: string,
): Promise<Company | undefined> {
	const [row] = await db
		.select()
		.from(companies)
		.where(eq(companies.slug, slug))
		.limit(1);
	return row;
}

function publishedWhere(companyId: number, filter: ReviewFilter): SQL | undefined {
	const conditions = [
		eq(reviews.companyId, companyId),
		eq(reviews.status, "published"),
	];
	if (filter.minRating && filter.minRating > 1) {
		conditions.push(gte(reviews.rating, filter.minRating));
	}
	if (filter.sources && filter.sources.length > 0) {
		conditions.push(inArray(reviews.source, filter.sources));
	}
	return and(...conditions);
}

/** Published reviews for a company in display order, honoring the display filter. */
export function getPublishedReviews(
	db: Database,
	companyId: number,
	filter: ReviewFilter = {},
) {
	const base = db
		.select()
		.from(reviews)
		.where(publishedWhere(companyId, filter))
		.orderBy(...displayOrder);
	return filter.limit ? base.limit(filter.limit) : base;
}

/**
 * Reviews hand-picked for the homepage "featured" section, in display order.
 * Falls back to the most recent published reviews when none are flagged, so a
 * site that hasn't curated yet still shows something.
 */
export async function getFeaturedReviews(
	db: Database,
	companyId: number,
	filter: ReviewFilter & { fallbackLimit?: number } = {},
): Promise<Review[]> {
	const featured = await db
		.select()
		.from(reviews)
		.where(and(publishedWhere(companyId, filter), eq(reviews.featured, true)))
		.orderBy(...displayOrder);
	if (featured.length > 0) return featured;
	return getPublishedReviews(db, companyId, {
		...filter,
		limit: filter.fallbackLimit ?? 3,
	});
}

/** Every published review for a company, in display order, for the admin manager. */
export function getReviewsForAdmin(db: Database, companyId: number): Promise<Review[]> {
	return db
		.select()
		.from(reviews)
		.where(and(eq(reviews.companyId, companyId), eq(reviews.status, "published")))
		.orderBy(...displayOrder);
}

/**
 * Persist a hand-set ordering and featured selection for one company's reviews.
 * `orderedIds` is the full list of review ids in their new display order; each
 * row's `sort_order` becomes its index. `featuredIds` flags the homepage picks.
 * Scoped to `companyId` so one tenant can never reorder another's reviews.
 */
export async function saveReviewOrder(
	db: Database,
	companyId: number,
	orderedIds: number[],
	featuredIds: number[],
): Promise<void> {
	if (orderedIds.length === 0) return;
	const featured = new Set(featuredIds);
	const rows = orderedIds.map(
		(id, i) => sql`(${id}::int, ${i}::int, ${featured.has(id)}::boolean)`,
	);
	await db.execute(sql`
		UPDATE ${reviews} AS r
		SET sort_order = v.ord, featured = v.feat, updated_at = now()
		FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, ord, feat)
		WHERE r.id = v.id AND r.company_id = ${companyId}
	`);
}

export interface ReviewStats {
	/** Total published reviews (rated + unrated). */
	count: number;
	/** Published reviews that carry a star rating. */
	ratedCount: number;
	/** Mean star rating over rated reviews, or 0 when there are none. */
	averageRating: number;
	/** Count of rated published reviews for each star value, keyed 1-5. */
	distribution: Record<number, number>;
}

/** Aggregate stats over a company's published reviews, in a single grouped query. */
export async function getReviewStats(
	db: Database,
	companyId: number,
	filter: Omit<ReviewFilter, "limit"> = {},
): Promise<ReviewStats> {
	const rows = await db
		.select({ rating: reviews.rating, total: count() })
		.from(reviews)
		.where(publishedWhere(companyId, filter))
		.groupBy(reviews.rating);

	const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	let total = 0;
	let ratedCount = 0;
	let weighted = 0;
	for (const row of rows) {
		const n = Number(row.total);
		total += n;
		if (row.rating != null) {
			distribution[row.rating] = n;
			ratedCount += n;
			weighted += row.rating * n;
		}
	}

	return {
		count: total,
		ratedCount,
		averageRating: ratedCount === 0 ? 0 : weighted / ratedCount,
		distribution,
	};
}

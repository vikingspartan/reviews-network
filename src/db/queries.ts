import { and, count, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import type { Database } from "./index";
import { type Company, companies, reviews } from "./schema";

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

/** Published reviews for a company, newest first, honoring the display filter. */
export function getPublishedReviews(
	db: Database,
	companyId: number,
	filter: ReviewFilter = {},
) {
	const base = db
		.select()
		.from(reviews)
		.where(publishedWhere(companyId, filter))
		.orderBy(desc(reviews.reviewedAt));
	return filter.limit ? base.limit(filter.limit) : base;
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

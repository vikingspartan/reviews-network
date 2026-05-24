import { count, desc, eq } from "drizzle-orm";
import type { Database } from "./index";
import { reviews } from "./schema";

/** Published reviews, newest first. Pass a `limit` to fetch only the latest few. */
export function getPublishedReviews(db: Database, limit?: number) {
	const query = db
		.select()
		.from(reviews)
		.where(eq(reviews.status, "published"))
		.orderBy(desc(reviews.reviewedAt));
	return limit ? query.limit(limit) : query;
}

export interface ReviewStats {
	/** Total number of published reviews. */
	count: number;
	/** Mean star rating, or 0 when there are no reviews. */
	averageRating: number;
	/** Count of published reviews for each star value, keyed 1-5. */
	distribution: Record<number, number>;
}

/** Aggregate stats over published reviews, computed in a single grouped query. */
export async function getReviewStats(db: Database): Promise<ReviewStats> {
	const rows = await db
		.select({ rating: reviews.rating, total: count() })
		.from(reviews)
		.where(eq(reviews.status, "published"))
		.groupBy(reviews.rating);

	const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	let total = 0;
	let weighted = 0;
	for (const row of rows) {
		const n = Number(row.total);
		distribution[row.rating] = n;
		total += n;
		weighted += row.rating * n;
	}

	return {
		count: total,
		averageRating: total === 0 ? 0 : weighted / total,
		distribution,
	};
}

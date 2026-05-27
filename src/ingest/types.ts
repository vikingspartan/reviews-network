import type { Company, ReviewSource } from "../db/schema";

/**
 * A review candidate fetched from an external source, before keyword/rating
 * filtering and normalization into the `reviews` table.
 */
export interface RawReview {
	/** Stable id from the source platform; used for de-duplication. */
	sourceReviewId: string;
	authorName: string;
	authorLocation?: string | null;
	/** 1-5 if the source has star ratings; null for unrated sources (e.g. Reddit). */
	rating?: number | null;
	title?: string | null;
	body: string;
	product?: string | null;
	sourceUrl?: string | null;
	reviewedAt?: Date | null;
}

export interface SourceRunContext {
	company: Company;
	source: ReviewSource;
}

/** A connector that fetches review candidates for one kind of source. */
export interface Connector {
	kind: ReviewSource["kind"];
	fetch(ctx: SourceRunContext): Promise<RawReview[]>;
}

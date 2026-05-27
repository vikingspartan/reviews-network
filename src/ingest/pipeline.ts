import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import {
	type Company,
	companies,
	type NewReview,
	type ReviewSource,
	reviews,
	reviewSources,
} from "../db/schema";
import { getConnector } from "./sources";

export interface SourceResult {
	kind: ReviewSource["kind"];
	sourceId: number;
	fetched: number;
	matched: number;
	inserted: number;
	skipped: number;
	error?: string;
}

/** Keep text if it passes the include/exclude keyword filters (case-insensitive). */
function matchesKeywords(
	text: string,
	include: string[],
	exclude: string[],
): boolean {
	const haystack = text.toLowerCase();
	if (exclude.some((k) => haystack.includes(k.toLowerCase()))) return false;
	if (include.length > 0 && !include.some((k) => haystack.includes(k.toLowerCase()))) {
		return false;
	}
	return true;
}

/** Keep a rating within [min, max]. Unrated reviews pass only when no min is set. */
function passesRating(
	rating: number | null | undefined,
	min: number | null,
	max: number | null,
): boolean {
	if (rating == null) return min == null;
	if (min != null && rating < min) return false;
	if (max != null && rating > max) return false;
	return true;
}

/** Run one source: fetch → filter by keyword/rating → dedupe → insert as pending. */
export async function runSource(
	db: Database,
	company: Company,
	source: ReviewSource,
): Promise<SourceResult> {
	const result: SourceResult = {
		kind: source.kind,
		sourceId: source.id,
		fetched: 0,
		matched: 0,
		inserted: 0,
		skipped: 0,
	};

	try {
		const raw = await getConnector(source.kind).fetch({ company, source });
		result.fetched = raw.length;

		const candidates = raw.filter((r) => {
			const text = `${r.title ?? ""} ${r.body}`;
			return (
				matchesKeywords(text, source.includeKeywords, source.excludeKeywords) &&
				passesRating(r.rating, source.minRating, source.maxRating)
			);
		});
		result.matched = candidates.length;

		if (candidates.length > 0) {
			const rows: NewReview[] = candidates.map((r) => ({
				companyId: company.id,
				authorName: r.authorName,
				authorLocation: r.authorLocation ?? null,
				rating: r.rating ?? null,
				title: r.title ?? null,
				body: r.body,
				product: r.product ?? null,
				source: source.kind,
				sourceReviewId: r.sourceReviewId,
				sourceUrl: r.sourceUrl ?? null,
				verified: false,
				// Ingested reviews are staged for moderation, not auto-published.
				status: "pending",
				...(r.reviewedAt ? { reviewedAt: r.reviewedAt } : {}),
			}));

			const inserted = await db
				.insert(reviews)
				.values(rows)
				.onConflictDoNothing()
				.returning({ id: reviews.id });
			result.inserted = inserted.length;
			result.skipped = rows.length - inserted.length;
		}

		await db
			.update(reviewSources)
			.set({ lastRunAt: new Date() })
			.where(eq(reviewSources.id, source.id));
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	}

	return result;
}

/** Run all enabled sources for a company (optionally a single kind). */
export async function runCompany(
	db: Database,
	slug: string,
	kindFilter?: ReviewSource["kind"],
): Promise<{ company: Company; results: SourceResult[] }> {
	const [company] = await db
		.select()
		.from(companies)
		.where(eq(companies.slug, slug))
		.limit(1);
	if (!company) throw new Error(`Unknown company: ${slug}`);

	const sources = await db
		.select()
		.from(reviewSources)
		.where(
			and(
				eq(reviewSources.companyId, company.id),
				eq(reviewSources.enabled, true),
			),
		);

	const selected = kindFilter
		? sources.filter((s) => s.kind === kindFilter)
		: sources;

	const results: SourceResult[] = [];
	for (const source of selected) {
		results.push(await runSource(db, company, source));
	}
	return { company, results };
}

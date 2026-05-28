/**
 * Register a company + a Trustpilot review source so `npm run ingest` can pull it.
 *
 * Usage:
 *   npm run add:trustpilot -- --company <slug> --tp <trustpilot-slug> [options]
 *
 * Example:
 *   npm run add:trustpilot -- --company storyworth --tp www.storyworth.com \
 *     --name Storyworth --min-rating 1 --max-rating 4 --review-pages 2
 *
 * Options:
 *   --company <slug>     companies.slug (created if missing)            [required]
 *   --tp <slug>          trustpilot.com/review/<slug> path segment      [required]
 *   --name <name>        display name (defaults to a prettified slug)
 *   --website <url>      company website
 *   --min-rating <1-5>   drop reviews below this rating
 *   --max-rating <1-5>   drop reviews above this rating
 *   --include <csv>      keep only reviews whose text contains one of these
 *   --exclude <csv>      drop reviews whose text contains any of these
 *   --review-pages <n>   Trustpilot pages to scrape, ~20 reviews each (default 3)
 *   --max-reviews <n>    stop once this many in-band reviews are collected (cap)
 *
 * The (company, trustpilot, tp-slug) source is upserted: re-running updates the
 * existing source's filters rather than creating a duplicate.
 */
import { and, eq } from "drizzle-orm";
import {
	companies,
	createDb,
	type NewReviewSource,
	reviewSources,
} from "../src/db/index";

try {
	process.loadEnvFile(".env");
} catch {
	// Fall back to an already-populated environment.
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is not set. Add it to .env or export it first.");
	process.exit(1);
}

function getFlag(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i !== -1 ? process.argv[i + 1] : undefined;
}

function getIntFlag(name: string): number | undefined {
	const v = getFlag(name);
	if (v === undefined) return undefined;
	const n = Number.parseInt(v, 10);
	if (!Number.isInteger(n)) {
		console.error(`--${name} must be an integer, got "${v}"`);
		process.exit(1);
	}
	return n;
}

function getListFlag(name: string): string[] {
	const v = getFlag(name);
	return v
		? v
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [];
}

function prettifySlug(slug: string): string {
	return slug
		.split(/[-_.]/)
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

async function main(): Promise<void> {
	const companySlug = getFlag("company")?.trim();
	const tpSlug = getFlag("tp")?.trim();
	if (!companySlug || !tpSlug) {
		console.error(
			"Usage: npm run add:trustpilot -- --company <slug> --tp <trustpilot-slug> " +
				"[--name <name>] [--website <url>] [--min-rating <1-5>] [--max-rating <1-5>] " +
				"[--include <csv>] [--exclude <csv>] [--review-pages <n>]",
		);
		process.exit(1);
	}

	const name = getFlag("name")?.trim() || prettifySlug(companySlug);
	const website = getFlag("website")?.trim();
	const minRating = getIntFlag("min-rating");
	const maxRating = getIntFlag("max-rating");
	const includeKeywords = getListFlag("include");
	const excludeKeywords = getListFlag("exclude");
	const reviewPages = getIntFlag("review-pages") ?? 3;
	const maxReviews = getIntFlag("max-reviews");

	const db = createDb(DATABASE_URL as string);

	// Upsert the company by slug.
	const [existing] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.slug, companySlug))
		.limit(1);
	let companyId = existing?.id;
	if (companyId === undefined) {
		const [created] = await db
			.insert(companies)
			.values({ slug: companySlug, name, website: website ?? null })
			.returning({ id: companies.id });
		companyId = created.id;
		console.log(`Created company "${companySlug}" (id ${companyId}).`);
	} else {
		console.log(`Using existing company "${companySlug}" (id ${companyId}).`);
	}

	const config = {
		slug: tpSlug,
		reviewPages,
		...(maxReviews !== undefined ? { maxReviews } : {}),
	};
	const filters = {
		includeKeywords,
		excludeKeywords,
		minRating: minRating ?? null,
		maxRating: maxRating ?? null,
		enabled: true,
	};

	// Upsert the trustpilot source for this company + tp slug.
	const sources = await db
		.select()
		.from(reviewSources)
		.where(
			and(
				eq(reviewSources.companyId, companyId),
				eq(reviewSources.kind, "trustpilot"),
			),
		);
	const match = sources.find(
		(s) => (s.config as { slug?: string }).slug === tpSlug,
	);

	if (match) {
		await db
			.update(reviewSources)
			.set({ config, ...filters })
			.where(eq(reviewSources.id, match.id));
		console.log(`Updated trustpilot source #${match.id} for "${tpSlug}".`);
	} else {
		const values: NewReviewSource = { companyId, kind: "trustpilot", config, ...filters };
		const [created] = await db
			.insert(reviewSources)
			.values(values)
			.returning({ id: reviewSources.id });
		console.log(`Added trustpilot source #${created.id} for "${tpSlug}".`);
	}

	console.log(
		`  filters: rating ${minRating ?? "-"}..${maxRating ?? "-"}, ` +
			`include [${includeKeywords.join(", ")}], exclude [${excludeKeywords.join(", ")}], ` +
			`reviewPages ${reviewPages}, maxReviews ${maxReviews ?? "-"}`,
	);
	console.log(`Next: npm run ingest -- ${companySlug} trustpilot`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

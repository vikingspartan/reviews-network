/**
 * Import a company's reviews from a CSV file into the Neon database.
 *
 * Usage:
 *   npm run import:reviews -- <file.csv> <company-slug> [company-name]
 *   npm run import:reviews -- data/reviews.sample.csv memorygram Memorygram
 *
 * The company is upserted by slug (created if it doesn't exist). Reviews are
 * tagged with that company's id. Re-imports are idempotent for rows that carry
 * a `source_review_id` (deduped via the unique index); rows without one always
 * insert (e.g. manual/CSV entries).
 *
 * Expected CSV columns (header row required; only author_name, rating, body are
 * required per row):
 *   author_name, author_location, rating, title, body, product,
 *   source, source_review_id, source_url, verified, status, reviewed_at
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import { companies, createDb, type NewReview, reviews } from "../src/db/index";

try {
	process.loadEnvFile(".env");
} catch {
	// Fall back to an already-populated environment.
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error(
		"DATABASE_URL is not set. Add it to .env or export it before running.",
	);
	process.exit(1);
}

const STATUSES = ["published", "pending", "hidden"] as const;
type Status = (typeof STATUSES)[number];

interface CsvRow {
	author_name?: string;
	author_location?: string;
	rating?: string;
	title?: string;
	body?: string;
	product?: string;
	source?: string;
	source_review_id?: string;
	source_url?: string;
	verified?: string;
	status?: string;
	reviewed_at?: string;
}

function toBool(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function prettifySlug(slug: string): string {
	return slug
		.split(/[-_]/)
		.filter(Boolean)
		.map((word) => word[0].toUpperCase() + word.slice(1))
		.join(" ");
}

function parseRow(row: CsvRow, companyId: number, rowNumber: number): NewReview {
	const where = `Row ${rowNumber}`;

	const authorName = row.author_name?.trim();
	if (!authorName) throw new Error(`${where}: author_name is required`);

	const body = row.body?.trim();
	if (!body) throw new Error(`${where}: body is required`);

	const rating = Number.parseInt(row.rating ?? "", 10);
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new Error(
			`${where}: rating must be an integer 1-5, got "${row.rating ?? ""}"`,
		);
	}

	const status = (row.status?.trim() || "published") as Status;
	if (!STATUSES.includes(status)) {
		throw new Error(
			`${where}: status must be one of ${STATUSES.join(", ")}, got "${status}"`,
		);
	}

	const review: NewReview = {
		companyId,
		authorName,
		authorLocation: row.author_location?.trim() || null,
		rating,
		title: row.title?.trim() || null,
		body,
		product: row.product?.trim() || null,
		source: row.source?.trim() || "website",
		sourceReviewId: row.source_review_id?.trim() || null,
		sourceUrl: row.source_url?.trim() || null,
		verified: toBool(row.verified),
		status,
	};

	const reviewedAt = row.reviewed_at?.trim();
	if (reviewedAt) {
		const date = new Date(reviewedAt);
		if (Number.isNaN(date.getTime())) {
			throw new Error(`${where}: reviewed_at is not a valid date: "${reviewedAt}"`);
		}
		review.reviewedAt = date;
	}

	return review;
}

async function main(): Promise<void> {
	const file = process.argv[2];
	const slug = process.argv[3]?.trim();
	const name = process.argv[4]?.trim();

	if (!file || !slug) {
		console.error(
			"Usage: tsx scripts/import-reviews.ts <file.csv> <company-slug> [company-name]",
		);
		process.exit(1);
	}

	const csv = readFileSync(resolve(file), "utf8");
	const parsed = Papa.parse<CsvRow>(csv, {
		header: true,
		skipEmptyLines: true,
		transformHeader: (header) => header.trim(),
	});

	if (parsed.errors.length > 0) {
		console.error("CSV parse errors:", parsed.errors.slice(0, 5));
		process.exit(1);
	}

	const db = createDb(DATABASE_URL as string);

	// Upsert the company by slug.
	const [existing] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.slug, slug))
		.limit(1);
	let companyId = existing?.id;
	if (companyId === undefined) {
		const [created] = await db
			.insert(companies)
			.values({ slug, name: name ?? prettifySlug(slug) })
			.returning({ id: companies.id });
		companyId = created.id;
		console.log(`Created company "${slug}" (id ${companyId}).`);
	}

	const rows = parsed.data.map((row, i) => parseRow(row, companyId, i + 2));
	if (rows.length === 0) {
		console.log("No rows to import.");
		return;
	}

	const inserted = await db
		.insert(reviews)
		.values(rows)
		.onConflictDoNothing()
		.returning({ id: reviews.id });

	const skipped = rows.length - inserted.length;
	console.log(
		`Imported ${inserted.length} review(s) for "${slug}" from ${file}` +
			(skipped > 0 ? ` (${skipped} duplicate(s) skipped).` : "."),
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

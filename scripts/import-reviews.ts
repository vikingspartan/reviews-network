/**
 * Import customer reviews from a CSV file into the Neon database.
 *
 * Usage:
 *   npm run import:reviews                 # imports data/reviews.sample.csv
 *   npm run import:reviews path/to/file.csv
 *
 * Expected CSV columns (header row required):
 *   author_name, author_location, rating, title, body,
 *   product, source, verified, status, reviewed_at
 *
 * Only author_name, rating, and body are required per row.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { createDb, reviews, type NewReview } from "../src/db/index";

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
	verified?: string;
	status?: string;
	reviewed_at?: string;
}

function toBool(value: string | undefined): boolean {
	if (!value) return false;
	return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function parseRow(row: CsvRow, rowNumber: number): NewReview {
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
		authorName,
		authorLocation: row.author_location?.trim() || null,
		rating,
		title: row.title?.trim() || null,
		body,
		product: row.product?.trim() || null,
		source: row.source?.trim() || "website",
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
	const file = process.argv[2] ?? "data/reviews.sample.csv";
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

	const rows = parsed.data.map((row, i) => parseRow(row, i + 2));
	if (rows.length === 0) {
		console.log("No rows to import.");
		return;
	}

	const db = createDb(DATABASE_URL as string);
	const inserted = await db
		.insert(reviews)
		.values(rows)
		.returning({ id: reviews.id });

	console.log(`Imported ${inserted.length} review(s) from ${file}.`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

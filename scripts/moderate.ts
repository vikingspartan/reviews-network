/**
 * Moderate ingested reviews: inspect the pending queue and approve/reject.
 *
 * Usage:
 *   npm run moderate -- list [company-slug]
 *   npm run moderate -- approve <id> [<id>...]
 *   npm run moderate -- reject  <id> [<id>...]
 *   npm run moderate -- approve-all <company-slug> [source-kind]
 *
 * approve → status "published" (the review goes live);
 * reject  → status "hidden" (kept for the record, never shown).
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../src/db/index";
import { companies, reviews } from "../src/db/schema";

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

const db = createDb(DATABASE_URL);

function parseIds(args: string[]): number[] {
	if (args.length === 0) throw new Error("Expected one or more review ids.");
	const ids = args.map((a) => Number.parseInt(a, 10));
	if (ids.some((n) => !Number.isInteger(n))) {
		throw new Error("Review ids must be integers.");
	}
	return ids;
}

async function companyIdForSlug(slug: string): Promise<number> {
	const [row] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.slug, slug))
		.limit(1);
	if (!row) throw new Error(`Unknown company: ${slug}`);
	return row.id;
}

async function list(slug?: string): Promise<void> {
	const conditions = [eq(reviews.status, "pending")];
	if (slug) conditions.push(eq(reviews.companyId, await companyIdForSlug(slug)));

	const rows = await db
		.select({
			id: reviews.id,
			company: companies.slug,
			source: reviews.source,
			rating: reviews.rating,
			author: reviews.authorName,
			title: reviews.title,
			body: reviews.body,
		})
		.from(reviews)
		.innerJoin(companies, eq(companies.id, reviews.companyId))
		.where(and(...conditions))
		.orderBy(reviews.createdAt);

	if (rows.length === 0) {
		console.log("No pending reviews.");
		return;
	}
	console.log(`${rows.length} pending review(s):`);
	for (const r of rows) {
		const stars = r.rating != null ? `${r.rating}★` : "—";
		const text = (r.title ?? r.body).slice(0, 60);
		console.log(`  #${r.id}  ${r.company}  ${r.source}  ${stars}  ${r.author}: ${text}`);
	}
	console.log(`\nApprove: npm run moderate -- approve ${rows.map((r) => r.id).join(" ")}`);
}

async function setStatus(
	ids: number[],
	status: "published" | "hidden",
): Promise<void> {
	const updated = await db
		.update(reviews)
		.set({ status, updatedAt: new Date() })
		.where(inArray(reviews.id, ids))
		.returning({ id: reviews.id });
	const verb = status === "published" ? "Approved" : "Rejected";
	console.log(
		`${verb} ${updated.length} review(s): ${updated.map((u) => u.id).join(", ") || "(none matched)"}`,
	);
}

async function approveAll(slug: string, kind?: string): Promise<void> {
	const companyId = await companyIdForSlug(slug);
	const conditions = [
		eq(reviews.companyId, companyId),
		eq(reviews.status, "pending"),
	];
	if (kind) conditions.push(eq(reviews.source, kind));
	const updated = await db
		.update(reviews)
		.set({ status: "published", updatedAt: new Date() })
		.where(and(...conditions))
		.returning({ id: reviews.id });
	console.log(
		`Approved ${updated.length} pending review(s) for ${slug}${kind ? ` (${kind})` : ""}.`,
	);
}

const USAGE = `Usage:
  npm run moderate -- list [company-slug]
  npm run moderate -- approve <id> [<id>...]
  npm run moderate -- reject  <id> [<id>...]
  npm run moderate -- approve-all <company-slug> [source-kind]`;

async function main(): Promise<void> {
	const command = process.argv[2];
	const rest = process.argv.slice(3);
	switch (command) {
		case "list":
			await list(rest[0]?.trim() || undefined);
			break;
		case "approve":
			await setStatus(parseIds(rest), "published");
			break;
		case "reject":
			await setStatus(parseIds(rest), "hidden");
			break;
		case "approve-all":
			if (!rest[0]) throw new Error("approve-all needs a company slug.");
			await approveAll(rest[0].trim(), rest[1]?.trim() || undefined);
			break;
		default:
			console.error(USAGE);
			process.exit(1);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});

/**
 * Ingest a company's reviews from its configured sources.
 *
 * Usage:
 *   npm run ingest -- <company-slug> [source-kind]
 *   npm run ingest -- memorygram           # all enabled sources
 *   npm run ingest -- memorygram reddit    # just the reddit source(s)
 *
 * Fetched reviews are filtered by each source's keywords + rating range,
 * de-duplicated, and inserted with status="pending" for moderation.
 */
import { createDb } from "../src/db/index";
import type { ReviewSource } from "../src/db/schema";
import { runCompany } from "../src/ingest/pipeline";

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

async function main(): Promise<void> {
	const slug = process.argv[2]?.trim();
	const kind = process.argv[3]?.trim() as ReviewSource["kind"] | undefined;
	if (!slug) {
		console.error("Usage: tsx scripts/ingest.ts <company-slug> [source-kind]");
		process.exit(1);
	}

	const db = createDb(DATABASE_URL as string);
	const { company, results } = await runCompany(db, slug, kind);

	console.log(`Ingestion for ${company.name} (${slug}):`);
	if (results.length === 0) {
		console.log(
			`  No enabled sources configured${kind ? ` for kind "${kind}"` : ""}.`,
		);
		return;
	}

	let hadError = false;
	for (const r of results) {
		if (r.error) {
			hadError = true;
			console.log(`  [${r.kind} #${r.sourceId}] ERROR: ${r.error}`);
		} else {
			console.log(
				`  [${r.kind} #${r.sourceId}] fetched ${r.fetched}, matched ${r.matched}, inserted ${r.inserted} pending, ${r.skipped} duplicate(s) skipped`,
			);
		}
	}
	if (hadError) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});

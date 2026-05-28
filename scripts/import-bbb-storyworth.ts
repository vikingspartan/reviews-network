/**
 * One-off: import StoryWorth's publicly-displayed BBB content into `reviews`.
 *
 * BBB embeds the displayed items in each profile tab's server state:
 *   - /complaints       → `customerComplaints` (unrated; stored rating = null)
 *   - /customer-reviews → `customerReviews`    (star-rated)
 * Only items with a published narrative appear (9 complaints filed, 1 shown; 2
 * reviews). This reads a saved copy of a tab and inserts each item as a
 * `source='bbb'`, published review (idempotent on the dedupe index).
 *
 * Usage:
 *   npm run import:bbb-storyworth -- <path-to-saved-tab.html>
 * Pass the complaints page and/or the customer-reviews page (run once per file).
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { companies, createDb, type NewReview, reviews } from "../src/db/index";

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

const COMPANY_SLUG = "storyworth";
const PROFILE =
	"https://www.bbb.org/us/de/claymont/profile/publishers-representatives/storyworth-inc-0251-92026609";

type BbbDate = { day: string; month: string; year: string };

/**
 * Pull the bracket-balanced array that follows `"<key>":` whose first element
 * satisfies `looksRight` — BBB reuses key names (e.g. an unrelated
 * `customerReviews` array of complaint-qualification questions), so the shape
 * check disambiguates.
 */
function extractArray(
	html: string,
	key: string,
	looksRight: (item: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
	let pos = 0;
	while ((pos = html.indexOf(`"${key}":`, pos + 1)) >= 0) {
		const start = html.indexOf("[", pos);
		let depth = 0;
		let inStr = false;
		let esc = false;
		for (let k = start; k < html.length; k++) {
			const c = html[k];
			if (inStr) {
				if (esc) esc = false;
				else if (c === "\\") esc = true;
				else if (c === '"') inStr = false;
			} else if (c === '"') inStr = true;
			else if (c === "[") depth++;
			else if (c === "]") {
				depth--;
				if (depth === 0) {
					try {
						const arr = JSON.parse(html.slice(start, k + 1));
						if (Array.isArray(arr) && arr.length && looksRight(arr[0])) return arr;
					} catch {
						// keep scanning for a later, valid match
					}
					break;
				}
			}
		}
	}
	return [];
}

/** Strip the HTML tags / entities BBB stores in narrative fields. */
function clean(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function toDate(d?: BbbDate): Date | undefined {
	if (!d) return undefined;
	const parsed = new Date(`${d.year}-${d.month}-${d.day}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function row(
	companyId: number,
	fields: Partial<NewReview> & { sourceReviewId: string; body: string },
): NewReview {
	return {
		companyId,
		authorName: "BBB user",
		authorLocation: null,
		rating: null,
		title: null,
		product: null,
		source: "bbb",
		sourceUrl: PROFILE,
		verified: false,
		status: "published",
		...fields,
	};
}

async function main(): Promise<void> {
	const path = process.argv[2];
	if (!path) {
		console.error("Usage: npm run import:bbb-storyworth -- <path-to-saved-tab.html>");
		process.exit(1);
	}
	const html = readFileSync(path, "utf8");

	const complaints = extractArray(
		html,
		"customerComplaints",
		(c) => typeof c.text === "string" && (c.type !== undefined || c.responses !== undefined),
	);
	const customerReviews = extractArray(
		html,
		"customerReviews",
		(r) => r.reviewStarRating !== undefined,
	);

	const db = createDb(DATABASE_URL as string);
	const [company] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.slug, COMPANY_SLUG))
		.limit(1);
	if (!company) throw new Error(`Unknown company: ${COMPANY_SLUG}`);

	const rows: NewReview[] = [];

	for (const c of complaints) {
		if (!(c.text as string)?.trim()) continue;
		rows.push(
			row(company.id, {
				authorName: "BBB complainant",
				title: c.type ? `BBB Complaint: ${c.type}` : "BBB Complaint",
				body: clean(c.text as string),
				sourceReviewId: `bbb_${c.id}`,
				sourceUrl: `${PROFILE}/complaints`,
				...(toDate(c.date as BbbDate) ? { reviewedAt: toDate(c.date as BbbDate) } : {}),
			}),
		);
	}

	for (const r of customerReviews) {
		// `text` is the consumer's review; `extendedText` is the business's reply thread.
		const text = r.text as string;
		const rating = Number(r.reviewStarRating);
		if (!text?.trim()) continue;
		rows.push(
			row(company.id, {
				authorName: (r.displayName as string)?.trim() || "BBB reviewer",
				rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
				body: clean(text),
				sourceReviewId: `bbb_${r.id}`,
				sourceUrl: `${PROFILE}/customer-reviews`,
				...(toDate(r.date as BbbDate) ? { reviewedAt: toDate(r.date as BbbDate) } : {}),
			}),
		);
	}

	if (rows.length === 0) {
		console.log(`No BBB complaints or customer reviews found in ${path}.`);
		return;
	}

	const inserted = await db
		.insert(reviews)
		.values(rows)
		.onConflictDoNothing()
		.returning({ id: reviews.id });

	console.log(
		`Imported ${inserted.length}/${rows.length} BBB item(s) for ${COMPANY_SLUG} ` +
			`(${complaints.length} complaint(s) + ${customerReviews.length} review(s) found; ` +
			`${rows.length - inserted.length} already present).`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});

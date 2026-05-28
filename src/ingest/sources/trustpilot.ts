import type { Connector, RawReview, SourceRunContext } from "../types";

const TP_BASE = "https://www.trustpilot.com";

// Trustpilot serves the full review markup only to browser-like clients.
const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface TrustpilotConfig {
	/**
	 * Trustpilot review-page slug for the company: the path segment in
	 * trustpilot.com/review/<slug> (usually the company's domain, e.g.
	 * "www.example.com" or "example.com").
	 */
	slug?: string;
	/** How many review pages to scrape (~20 reviews each). Default 3. */
	reviewPages?: number;
	/**
	 * Stop once this many reviews inside the source's rating band have been
	 * collected, scanning pages in order. Caps both the output and the number of
	 * pages fetched. Omit to return everything from `reviewPages` and let the
	 * pipeline apply the rating filter.
	 */
	maxReviews?: number;
}

/**
 * Scrapes a company's reviews from its public Trustpilot review pages.
 *
 * Trustpilot is a Next.js site, so the primary data source is the page's
 * embedded `__NEXT_DATA__` JSON, with JSON-LD as a fallback for when that shape
 * changes. Reviews are returned as `RawReview[]`; the ingest pipeline applies
 * the source's keyword/rating filters, de-duplicates on `sourceReviewId`, and
 * stages them as `pending` for moderation.
 *
 * Config: `{ "slug": "www.example.com", "reviewPages": 3, "maxReviews": 100 }`.
 * Trustpilot fronts its pages with an AWS WAF JS challenge, so live fetches need
 * either Bright Data's Web Unlocker (BRIGHT_DATA_API_KEY + BRIGHT_DATA_UNLOCKER_ZONE,
 * which solves the challenge server-side) or, at minimum, a residential proxy
 * (BRIGHT_DATA_PROXY_URL) — a plain server-side request just gets a 403.
 */
export const trustpilotConnector: Connector = {
	kind: "trustpilot",
	async fetch({ source }: SourceRunContext): Promise<RawReview[]> {
		const cfg = source.config as TrustpilotConfig;
		const slug = cfg.slug?.trim();
		if (!slug) {
			throw new Error(
				'Trustpilot connector requires config.slug — the trustpilot.com/review/<slug> path segment, e.g. { "slug": "www.example.com" }.',
			);
		}

		const maxPages = Math.max(1, cfg.reviewPages ?? 3);
		// When set, collect only reviews inside the source's rating band and stop
		// once we have this many — so the run yields the first N matching reviews
		// in page order rather than everything on the scraped pages.
		const maxReviews =
			cfg.maxReviews && cfg.maxReviews > 0 ? cfg.maxReviews : undefined;
		// Push the rating band into the request itself: Trustpilot's `stars` filter
		// returns only the matching reviews, so a narrow band (e.g. 1–3 of a mostly
		// 5-star company) needs a handful of pages instead of scanning thousands.
		const starsFilter = starsForBand(source.minRating, source.maxRating);
		const seen = new Set<string>();
		const all: RawReview[] = [];

		for (let page = 1; page <= maxPages; page++) {
			const params = new URLSearchParams();
			if (page > 1) params.set("page", String(page));
			for (const s of starsFilter) params.append("stars", String(s));
			const qs = params.toString();
			const url = `${TP_BASE}/review/${slug}${qs ? `?${qs}` : ""}`;

			let html: string;
			try {
				html = await fetchPage(url);
			} catch (error) {
				// A failed fetch (e.g. paging past the last page) ends pagination;
				// only surface the error when we have nothing at all to return.
				if (all.length === 0) throw error;
				break;
			}

			// Prefer __NEXT_DATA__; fall back to JSON-LD if the page shape changed.
			let pageReviews = reviewsFromNextData(html, slug);
			if (pageReviews.length === 0) {
				pageReviews = reviewsFromJsonLd(html, slug);
			}
			if (pageReviews.length === 0) break; // no (more) reviews on this page

			let added = 0;
			for (const review of pageReviews) {
				if (seen.has(review.sourceReviewId)) continue;
				seen.add(review.sourceReviewId);
				added++; // counts new (deduped) reviews, to detect the end of the list
				// With a cap, keep only in-band reviews and stop as soon as we have enough.
				if (
					maxReviews !== undefined &&
					!inRatingBand(review.rating ?? null, source.minRating, source.maxRating)
				) {
					continue;
				}
				all.push(review);
				if (maxReviews !== undefined && all.length >= maxReviews) return all;
			}
			// A page that only repeats earlier reviews means we've reached the end.
			if (added === 0) break;
		}

		return all;
	},
};

// Reuse one proxy dispatcher across requests when BRIGHT_DATA_PROXY_URL is set
// (e.g. a Bright Data residential superproxy: http://user:pass@host:port).
// Trustpilot 403s plain server-side requests, so live fetches need this. undici
// is imported lazily so it never gets pulled into the Cloudflare Worker bundle.
let dispatcherInit: Promise<unknown | undefined> | undefined;

function getDispatcher(): Promise<unknown | undefined> {
	if (!dispatcherInit) {
		dispatcherInit = (async () => {
			const proxyUrl = process.env.BRIGHT_DATA_PROXY_URL?.trim();
			if (!proxyUrl) return undefined;
			const { ProxyAgent } = await import("undici");
			// Bright Data's Web Unlocker terminates TLS to solve the challenge and
			// presents its own (self-signed) cert, so the origin cert can't be
			// verified — the proxy itself is the trusted endpoint.
			return new ProxyAgent({
				uri: proxyUrl,
				requestTls: { rejectUnauthorized: false },
			});
		})();
	}
	return dispatcherInit;
}

const UNLOCKER_API = "https://api.brightdata.com/request";

async function fetchPage(url: string): Promise<string> {
	// Prefer the Web Unlocker API when configured: it solves Trustpilot's AWS WAF
	// challenge server-side and returns the final HTML. Falls back to a residential
	// proxy (or a plain request) when only BRIGHT_DATA_PROXY_URL / nothing is set.
	const apiKey = process.env.BRIGHT_DATA_API_KEY?.trim();
	const zone = process.env.BRIGHT_DATA_UNLOCKER_ZONE?.trim();
	if (apiKey && zone) return fetchViaUnlocker(url, apiKey, zone);

	const dispatcher = await getDispatcher();
	const res = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html,application/xhtml+xml",
			"Accept-Language": "en-US,en;q=0.9",
		},
		// `dispatcher` is an undici extension to fetch, absent from the DOM types.
		...(dispatcher ? { dispatcher } : {}),
	} as RequestInit & { dispatcher?: unknown });
	if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
	return res.text();
}

// Bright Data Web Unlocker: POST the target URL and get back the unlocked HTML
// (format "raw"). The unlocker manages headers/JS/CAPTCHA, so we don't send our own.
async function fetchViaUnlocker(
	url: string,
	apiKey: string,
	zone: string,
): Promise<string> {
	const res = await fetch(UNLOCKER_API, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ zone, url, format: "raw", country: "us" }),
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(
			`Bright Data Unlocker API HTTP ${res.status} for ${url}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
		);
	}
	return res.text();
}

// ── Parsers ────────────────────────────────────────────────────────────────

// Trustpilot is a Next.js app; review data lives in the __NEXT_DATA__ blob.
function reviewsFromNextData(html: string, slug: string): RawReview[] {
	const next = extractNextData(html);
	const list = next?.props?.pageProps?.reviews;
	if (!Array.isArray(list)) return [];

	const out: RawReview[] = [];
	for (const r of list) {
		const body = String(r?.text ?? r?.body ?? "").trim();
		if (!body) continue; // body is required and must be non-empty

		const name =
			r?.consumer?.displayName ??
			`${r?.consumer?.firstName ?? ""} ${r?.consumer?.lastName ?? ""}`.trim();

		out.push(
			toRawReview(slug, {
				id: r?.id ?? r?.reviewId ?? null,
				authorName: name || "Trustpilot reviewer",
				authorLocation: r?.consumer?.countryCode ?? r?.consumer?.country ?? null,
				rating: clampRating(r?.rating ?? r?.stars),
				title: r?.title ?? r?.heading ?? null,
				body,
				reviewedAt: parseDate(r?.dates?.publishedDate ?? r?.createdAt),
			}),
		);
	}
	return out;
}

// Fallback: structured review data embedded as JSON-LD <script> blocks.
function reviewsFromJsonLd(html: string, slug: string): RawReview[] {
	const items: any[] = [];
	for (const block of extractJsonLd(html)) {
		if (block?.["@type"] === "Review") items.push(block);
		if (Array.isArray(block)) {
			items.push(...block.filter((d: any) => d?.["@type"] === "Review"));
		}
		if (Array.isArray(block?.["@graph"])) {
			items.push(...block["@graph"].filter((d: any) => d?.["@type"] === "Review"));
		}
		// A company page nests reviews under the Organization's "review" array.
		if (Array.isArray(block?.review)) {
			items.push(...block.review.filter((d: any) => d?.["@type"] === "Review"));
		}
	}

	const out: RawReview[] = [];
	for (const r of items) {
		const body = String(r?.reviewBody ?? "").trim();
		if (!body) continue;

		out.push(
			toRawReview(slug, {
				id: typeof r?.["@id"] === "string" ? r["@id"] : null,
				authorName: r?.author?.name ?? "Trustpilot reviewer",
				authorLocation: null,
				rating: clampRating(r?.reviewRating?.ratingValue),
				title: r?.headline ?? r?.name ?? null,
				body,
				reviewedAt: parseDate(r?.datePublished),
			}),
		);
	}
	return out;
}

function extractNextData(html: string): any | null {
	const match = html.match(
		/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!match) return null;
	try {
		return JSON.parse(match[1].trim());
	} catch {
		return null;
	}
}

function extractJsonLd(html: string): any[] {
	const results: any[] = [];
	const regex =
		/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(html)) !== null) {
		try {
			results.push(JSON.parse(match[1].trim()));
		} catch {
			// skip malformed JSON-LD
		}
	}
	return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toRawReview(
	slug: string,
	fields: {
		id?: string | null;
		authorName: string;
		authorLocation?: string | null;
		rating?: number | null;
		title?: string | null;
		body: string;
		reviewedAt?: Date | null;
	},
): RawReview {
	// Prefer Trustpilot's own review id for dedupe; otherwise derive a stable id
	// from the content so re-runs don't insert duplicates.
	const sourceReviewId = fields.id
		? `tp_${fields.id}`
		: `tp_${slug}_${stableId(
				`${fields.authorName}|${fields.reviewedAt?.toISOString() ?? ""}|${fields.body}`,
			)}`;

	return {
		sourceReviewId,
		authorName: fields.authorName,
		authorLocation: fields.authorLocation ?? null,
		rating: fields.rating ?? null,
		title: fields.title ?? null,
		body: fields.body,
		sourceUrl: fields.id
			? `${TP_BASE}/reviews/${fields.id}`
			: `${TP_BASE}/review/${slug}`,
		reviewedAt: fields.reviewedAt ?? null,
	};
}

// The Trustpilot `stars` values covering a [min, max] band. Returns [] for a full
// 1–5 band (no filter needed) so unconstrained sources still fetch every review.
function starsForBand(min: number | null, max: number | null): number[] {
	const lo = Math.max(1, min ?? 1);
	const hi = Math.min(5, max ?? 5);
	if (lo <= 1 && hi >= 5) return [];
	const out: number[] = [];
	for (let s = lo; s <= hi; s++) out.push(s);
	return out;
}

// Mirrors the pipeline's rating filter so a capped run counts only in-band reviews.
function inRatingBand(
	rating: number | null,
	min: number | null,
	max: number | null,
): boolean {
	if (rating == null) return min == null;
	if (min != null && rating < min) return false;
	if (max != null && rating > max) return false;
	return true;
}

function clampRating(value: unknown): number | null {
	const n = typeof value === "string" ? parseFloat(value) : (value as number);
	if (typeof n !== "number" || Number.isNaN(n)) return null;
	return Math.min(5, Math.max(1, Math.round(n)));
}

function parseDate(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

// djb2 string hash → base36; deterministic, dependency-free, runtime-agnostic.
function stableId(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

import type { Connector, RawReview, SourceRunContext } from "../types";

interface GoogleConfig {
	/** Google Place id for the company's listing. */
	placeId?: string;
}

interface GooglePlaceReview {
	author_name: string;
	rating: number;
	text: string;
	time: number;
	author_url?: string;
}

/**
 * Fetches reviews via the official Google Places API. Requires a
 * `GOOGLE_PLACES_API_KEY` and `config.placeId`.
 *
 * ⚠️ The Places API returns at most 5 reviews per place, and Google's terms
 * restrict storing and re-displaying review content — confirm compliance before
 * publishing ingested Google reviews.
 */
export const googleConnector: Connector = {
	kind: "google",
	async fetch({ source }: SourceRunContext): Promise<RawReview[]> {
		const apiKey = process.env.GOOGLE_PLACES_API_KEY;
		const cfg = source.config as GoogleConfig;
		if (!apiKey || !cfg.placeId) {
			throw new Error(
				"Google connector requires GOOGLE_PLACES_API_KEY and config.placeId (official Places API).",
			);
		}

		const url = new URL(
			"https://maps.googleapis.com/maps/api/place/details/json",
		);
		url.searchParams.set("place_id", cfg.placeId);
		url.searchParams.set("fields", "reviews");
		url.searchParams.set("key", apiKey);

		const res = await fetch(url);
		if (!res.ok) throw new Error(`Google fetch failed: HTTP ${res.status}`);

		const json = (await res.json()) as {
			result?: { reviews?: GooglePlaceReview[] };
		};
		return (json.result?.reviews ?? []).map((r) => ({
			// Place id + timestamp is stable per author review.
			sourceReviewId: `${cfg.placeId}:${r.time}`,
			authorName: r.author_name,
			rating: r.rating,
			body: r.text,
			sourceUrl: r.author_url ?? null,
			reviewedAt: new Date(r.time * 1000),
		}));
	},
};

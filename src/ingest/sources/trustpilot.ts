import type { Connector, RawReview, SourceRunContext } from "../types";

interface TrustpilotConfig {
	/** Trustpilot Business Unit id for the company. */
	businessUnitId?: string;
}

interface TrustpilotReview {
	id: string;
	consumer?: { displayName?: string; countryCode?: string };
	stars: number;
	title?: string;
	text: string;
	createdAt?: string;
}

/**
 * Fetches reviews via the official Trustpilot Business API. Requires a
 * `TRUSTPILOT_API_KEY` and `config.businessUnitId`.
 *
 * Scraping the Trustpilot website instead violates their terms of service, so
 * this connector only uses the sanctioned API.
 */
export const trustpilotConnector: Connector = {
	kind: "trustpilot",
	async fetch({ source }: SourceRunContext): Promise<RawReview[]> {
		const apiKey = process.env.TRUSTPILOT_API_KEY;
		const cfg = source.config as TrustpilotConfig;
		if (!apiKey || !cfg.businessUnitId) {
			throw new Error(
				"Trustpilot connector requires TRUSTPILOT_API_KEY and config.businessUnitId (official Trustpilot Business API).",
			);
		}

		const url = new URL(
			`https://api.trustpilot.com/v1/business-units/${cfg.businessUnitId}/reviews`,
		);
		url.searchParams.set("apikey", apiKey);
		url.searchParams.set("perPage", "100");

		const res = await fetch(url);
		if (!res.ok) throw new Error(`Trustpilot fetch failed: HTTP ${res.status}`);

		const json = (await res.json()) as { reviews?: TrustpilotReview[] };
		return (json.reviews ?? []).map((r) => ({
			sourceReviewId: r.id,
			authorName: r.consumer?.displayName ?? "Trustpilot reviewer",
			authorLocation: r.consumer?.countryCode ?? null,
			rating: r.stars,
			title: r.title ?? null,
			body: r.text,
			sourceUrl: `https://www.trustpilot.com/reviews/${r.id}`,
			reviewedAt: r.createdAt ? new Date(r.createdAt) : null,
		}));
	},
};

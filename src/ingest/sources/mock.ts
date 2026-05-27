import type { Connector, RawReview } from "../types";

/**
 * Deterministic connector used to exercise the pipeline (filtering, dedupe,
 * moderation) without hitting any external service. Returns a fixed set of
 * candidates spanning ratings and keywords.
 */
const FIXTURES: RawReview[] = [
	{
		sourceReviewId: "mock-1",
		authorName: "Ava P.",
		rating: 5,
		title: "A beautiful keepsake",
		body: "This keepsake brought my whole family to tears. Stunning quality.",
		sourceUrl: "https://example.com/mock-1",
		reviewedAt: new Date("2026-05-01"),
	},
	{
		sourceReviewId: "mock-2",
		authorName: "Ben R.",
		rating: 3,
		title: "Decent keepsake, slow shipping",
		body: "The keepsake was fine but delivery dragged on for weeks.",
		sourceUrl: "https://example.com/mock-2",
		reviewedAt: new Date("2026-05-03"),
	},
	{
		sourceReviewId: "mock-3",
		authorName: "Cara L.",
		rating: 5,
		title: "Great gift",
		body: "Lovely present, arrived on time. No complaints at all.",
		sourceUrl: "https://example.com/mock-3",
		reviewedAt: new Date("2026-05-05"),
	},
	{
		sourceReviewId: "mock-4",
		authorName: "Dan M.",
		rating: 4,
		title: "Lovely keepsake",
		body: "Solid keepsake, a little pricey but worth it for the occasion.",
		sourceUrl: "https://example.com/mock-4",
		reviewedAt: new Date("2026-05-07"),
	},
	{
		sourceReviewId: "mock-5",
		authorName: "Erin T.",
		rating: null,
		title: null,
		body: "Saw a keepsake from them mentioned in a thread — looked nice.",
		sourceUrl: "https://example.com/mock-5",
		reviewedAt: new Date("2026-05-09"),
	},
];

export const mockConnector: Connector = {
	kind: "mock",
	async fetch() {
		return FIXTURES;
	},
};

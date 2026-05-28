import type { Connector, RawReview, SourceRunContext } from "../types";

interface RedditConfig {
	/** Optional subreddit to restrict the search to (without "r/"). */
	subreddit?: string;
	/** Search query (keywords). Required. */
	query?: string;
	/** Max posts to fetch (capped at 100). */
	limit?: number;
}

interface RedditChild {
	data: {
		id: string;
		author?: string;
		title?: string;
		selftext?: string;
		permalink?: string;
		created_utc?: number;
	};
}

/**
 * Fetches Reddit posts matching a query via Reddit's public JSON endpoint.
 * Reddit content has no star ratings, so `rating` is always null — these are
 * keyword "mentions", filtered downstream by the source's keywords.
 *
 * Note: for production volume, use Reddit's OAuth API (https://www.reddit.com/dev/api)
 * with registered credentials and respect their rate limits and terms.
 */
export const redditConnector: Connector = {
	kind: "reddit",
	async fetch({ source }: SourceRunContext): Promise<RawReview[]> {
		const cfg = source.config as RedditConfig;
		if (!cfg.query) {
			throw new Error('Reddit source needs config.query (e.g. {"query":"storyworth"}).');
		}

		const limit = Math.min(cfg.limit ?? 50, 100);
		const base = cfg.subreddit
			? `https://www.reddit.com/r/${encodeURIComponent(cfg.subreddit)}/search.json`
			: "https://www.reddit.com/search.json";
		const params = new URLSearchParams({
			q: cfg.query,
			sort: "new",
			limit: String(limit),
		});
		if (cfg.subreddit) params.set("restrict_sr", "1");

		const res = await fetch(`${base}?${params}`, {
			headers: {
				"user-agent": "reviews-network-aggregator/0.1",
			},
		});
		if (!res.ok) {
			throw new Error(`Reddit fetch failed: HTTP ${res.status}`);
		}

		const json = (await res.json()) as { data?: { children?: RedditChild[] } };
		const children = json.data?.children ?? [];
		return children.map(({ data: post }) => ({
			sourceReviewId: post.id,
			authorName: post.author ?? "reddit user",
			rating: null,
			title: post.title ?? null,
			body: (post.selftext?.trim() || post.title || "").slice(0, 4000),
			sourceUrl: post.permalink
				? `https://www.reddit.com${post.permalink}`
				: null,
			reviewedAt: post.created_utc ? new Date(post.created_utc * 1000) : null,
		}));
	},
};

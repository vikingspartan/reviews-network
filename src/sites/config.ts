import { SHOP_URL, SITE_DESCRIPTION, SITE_TITLE } from "../consts";

/** Per-site display switches — "what to show and what to hide" for a frontend. */
export interface SiteSwitches {
	/** Show the 1-5 star distribution chart on the reviews page. */
	showDistribution: boolean;
	/** Show the "verified purchase" badge on reviews. */
	showVerifiedBadges: boolean;
	/** If set, only display reviews from these sources. */
	sources?: string[];
	/** If set, hide reviews below this star rating. */
	minRating?: number;
	/** If set, cap how many reviews the reviews page lists. */
	maxReviews?: number;
}

/**
 * Configuration for one frontend, selected by hostname. Multiple sites run off
 * the same Worker + database; this picks which company's reviews to serve and
 * how to brand/filter them.
 */
export interface SiteConfig {
	/** Which company's reviews this site shows (matches companies.slug). */
	companySlug: string;
	/** Display name of the company, used in copy without a DB lookup. */
	companyName: string;
	/** <title> / meta description for the site. */
	title: string;
	description: string;
	/** Accent color (hex), themes links and buttons. */
	accent: string;
	/** The company's own website, linked from header/footer. Omit to render the
	 * company name as plain text and show no outbound link to it. */
	shopUrl?: string;
	switches: SiteSwitches;
}

/** Memorygram — the default/primary site. */
export const DEFAULT_SITE: SiteConfig = {
	companySlug: "memorygram",
	companyName: "Memorygram",
	title: SITE_TITLE,
	description: SITE_DESCRIPTION,
	accent: "#2337ff",
	shopUrl: SHOP_URL,
	switches: { showDistribution: true, showVerifiedBadges: true },
};

/** Example second tenant, to demonstrate multiple companies on one instance. */
const BRIGHTSIDE_SITE: SiteConfig = {
	companySlug: "brightside",
	companyName: "Brightside Mattress",
	title: "Brightside Mattress Reviews",
	description:
		"Independent customer reviews of Brightside Mattress, aggregated from across the web.",
	accent: "#0c8a6a",
	shopUrl: "https://brightsidemattress.com",
	// This tenant hides verified badges and only surfaces 4★+ reviews.
	switches: { showDistribution: true, showVerifiedBadges: false, minRating: 4 },
};

/** Storyworth — aggregates the company's Trustpilot reviews. */
const STORYWORTH_SITE: SiteConfig = {
	companySlug: "storyworth",
	companyName: "Storyworth",
	title: "Storyworth Reviews",
	description:
		"Independent customer reviews of Storyworth, aggregated from across the web.",
	accent: "#e2603f",
	// No shopUrl: this site intentionally does not link out to storyworth.com.
	// Trustpilot reviews aren't verified purchases, so the badge is hidden.
	switches: { showDistribution: true, showVerifiedBadges: false },
};

/** Remento — aggregates the company's Trustpilot reviews. */
const REMENTO_SITE: SiteConfig = {
	companySlug: "remento",
	companyName: "Remento",
	title: "Remento Reviews",
	description:
		"Independent customer reviews of Remento, aggregated from across the web.",
	accent: "#0e7490",
	// No shopUrl: this site intentionally does not link out to remento.co.
	switches: { showDistribution: true, showVerifiedBadges: false },
};

/**
 * Hostname → site. Add a domain here (and its company row in the DB) to launch
 * another review site. The `*.localhost` hosts map the example tenants so they
 * can be exercised locally.
 */
const SITE_CONFIGS: Record<string, SiteConfig> = {
	"memorygramreviews.com": DEFAULT_SITE,
	"www.memorygramreviews.com": DEFAULT_SITE,
	localhost: DEFAULT_SITE,
	"brightsidereviews.com": BRIGHTSIDE_SITE,
	"www.brightsidereviews.com": BRIGHTSIDE_SITE,
	"127.0.0.1": BRIGHTSIDE_SITE,
	"storyworthreviews.com": STORYWORTH_SITE,
	"www.storyworthreviews.com": STORYWORTH_SITE,
	"storyworth.localhost": STORYWORTH_SITE,
	"rementoreviews.com": REMENTO_SITE,
	"www.rementoreviews.com": REMENTO_SITE,
	"remento.localhost": REMENTO_SITE,
};

/** Resolve the site for a hostname, falling back to the default site. */
export function resolveSite(hostname: string): SiteConfig {
	return SITE_CONFIGS[hostname.toLowerCase()] ?? DEFAULT_SITE;
}

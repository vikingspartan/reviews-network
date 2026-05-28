// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
// No global `site`: this is a multi-tenant SSR app — canonical/og URLs are
// derived per-request from the hostname (see BaseHead.astro).
export default defineConfig({
	integrations: [mdx()],
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
	}),
});

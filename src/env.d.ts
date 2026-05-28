type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {
		/** The review site for this request, resolved from the hostname by middleware. */
		site: import("./sites/config").SiteConfig;
	}
}

// Extend the Wrangler-generated Env with our own bindings/secrets.
// TypeScript merges this with the `Cloudflare.Env` in worker-configuration.d.ts.
declare namespace Cloudflare {
	interface Env {
		/**
		 * Neon Postgres connection string.
		 * Local dev: set in `.dev.vars`. Production: `wrangler secret put DATABASE_URL`.
		 */
		DATABASE_URL: string;
		/**
		 * Shared password for the /admin review manager.
		 * Local dev: set in `.dev.vars`. Production: `wrangler secret put ADMIN_PASSWORD`.
		 */
		ADMIN_PASSWORD: string;
		/** KV namespace holding admin login sessions (bound in wrangler.json). */
		SESSION: KVNamespace;
	}
}

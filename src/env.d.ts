type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
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
	}
}

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client backed by Neon's HTTP driver.
 *
 * The connection string is passed in explicitly so the same factory works in
 * every runtime:
 *   - Cloudflare Workers: `createDb(Astro.locals.runtime.env.DATABASE_URL)`
 *   - Node scripts:       `createDb(process.env.DATABASE_URL!)`
 */
export function createDb(connectionString: string) {
	const client = neon(connectionString);
	return drizzle(client, { schema });
}

export { schema };
export * from "./schema";

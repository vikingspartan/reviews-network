import { defineConfig } from "drizzle-kit";

// drizzle-kit runs this file under Node. Load .env so DATABASE_URL is available
// for `db:generate`, `db:migrate`, and `db:push`. In CI the variable is usually
// already present in the environment, so a missing .env is not an error.
try {
	process.loadEnvFile(".env");
} catch {
	// .env is optional.
}

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
});

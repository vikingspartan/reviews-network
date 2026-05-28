export const prerender = false;

import type { APIRoute } from "astro";
import { destroySession } from "../../lib/admin-auth";

/** Clear the admin session and return to the login page. */
export const POST: APIRoute = async (context) => {
	await destroySession(context);
	return context.redirect("/admin/login");
};

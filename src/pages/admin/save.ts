export const prerender = false;

import type { APIRoute } from "astro";
import { createDb } from "../../db";
import { getCompanyBySlug, saveReviewOrder } from "../../db/queries";
import { isAuthenticated } from "../../lib/admin-auth";

/**
 * Persist a new display order + featured selection for the current site's
 * company. Body: { orderedIds: number[], featuredIds: number[] }.
 */
export const POST: APIRoute = async (context) => {
	if (!(await isAuthenticated(context))) {
		return new Response("Unauthorized", { status: 401 });
	}

	let payload: { orderedIds?: unknown; featuredIds?: unknown };
	try {
		payload = await context.request.json();
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const orderedIds = payload.orderedIds;
	const featuredIds = payload.featuredIds;
	const isIntArray = (v: unknown): v is number[] =>
		Array.isArray(v) && v.every((n) => Number.isInteger(n));
	if (!isIntArray(orderedIds) || !isIntArray(featuredIds)) {
		return new Response("orderedIds and featuredIds must be integer arrays", {
			status: 400,
		});
	}

	const site = context.locals.site;
	const db = createDb(context.locals.runtime.env.DATABASE_URL);
	const company = await getCompanyBySlug(db, site.companySlug);
	if (!company) {
		return new Response(`Unknown company: ${site.companySlug}`, { status: 404 });
	}

	await saveReviewOrder(db, company.id, orderedIds, featuredIds);
	return new Response(JSON.stringify({ ok: true }), {
		headers: { "content-type": "application/json" },
	});
};

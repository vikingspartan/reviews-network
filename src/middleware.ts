import { defineMiddleware } from "astro:middleware";
import { resolveSite } from "./sites/config";

/**
 * Resolve which review site (company + branding + switches) this request is for,
 * based on the hostname, and make it available as `Astro.locals.site`.
 */
export const onRequest = defineMiddleware((context, next) => {
	context.locals.site = resolveSite(context.url.hostname);
	return next();
});

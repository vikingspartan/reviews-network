/**
 * Minimal session auth for the /admin review manager.
 *
 * A correct password (the `ADMIN_PASSWORD` secret) mints a random token stored
 * in the `SESSION` KV namespace and set as an HttpOnly cookie. Every admin
 * request looks the token up in KV; logout deletes it. Cookies are host-scoped,
 * so each review site is logged into independently.
 */
import type { APIContext } from "astro";

const COOKIE_NAME = "admin_session";
/** Sessions live for one week, refreshed implicitly by re-login. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const KV_PREFIX = "admin-session:";

type Ctx = APIContext | { cookies: APIContext["cookies"]; locals: App.Locals };

/** Constant-time-ish string compare to avoid leaking match progress via timing. */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/** True when the submitted password matches the configured admin password. */
export function passwordMatches(env: Cloudflare.Env, password: string): boolean {
	const expected = env.ADMIN_PASSWORD;
	return Boolean(expected) && safeEqual(password, expected);
}

/** Mint a session and set its cookie. Call only after the password checks out. */
export async function createSession(context: Ctx): Promise<void> {
	const token = crypto.randomUUID();
	const env = context.locals.runtime.env;
	await env.SESSION.put(`${KV_PREFIX}${token}`, "1", {
		expirationTtl: SESSION_TTL_SECONDS,
	});
	context.cookies.set(COOKIE_NAME, token, {
		httpOnly: true,
		secure: true,
		sameSite: "lax",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
	});
}

/** True when the request carries a valid admin session cookie. */
export async function isAuthenticated(context: Ctx): Promise<boolean> {
	const token = context.cookies.get(COOKIE_NAME)?.value;
	if (!token) return false;
	const found = await context.locals.runtime.env.SESSION.get(`${KV_PREFIX}${token}`);
	return found !== null;
}

/** Drop the session from KV and clear the cookie. */
export async function destroySession(context: Ctx): Promise<void> {
	const token = context.cookies.get(COOKIE_NAME)?.value;
	if (token) {
		await context.locals.runtime.env.SESSION.delete(`${KV_PREFIX}${token}`);
	}
	context.cookies.delete(COOKIE_NAME, { path: "/" });
}

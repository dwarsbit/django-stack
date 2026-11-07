import { reportError } from "@django-stack/utils";
import { redirect } from "@sveltejs/kit";
import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { getContent, PREVIEW_COOKIE } from "#lib/server/api.ts";
import { getCached, store } from "#lib/server/cache.ts";
import { dev } from "$app/env";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const CACHEABLE = /^(text\/html|application\/json|application\/xml|application\/rss\+xml|text\/plain)/;

// Where media files come from when they are not on this site: S3 or a CDN.
const MEDIA_ORIGINS = (process.env.MEDIA_ORIGINS ?? "")
  .split(",")
  .map((value) => {
    try {
      return new URL(value.trim()).origin;
    } catch {
      return "";
    }
  })
  .filter(Boolean)
  .map((origin) => ` ${origin}`)
  .join("");
const MEDIA_DIRECTIVES = `img-src 'self' data:${MEDIA_ORIGINS}; media-src 'self'${MEDIA_ORIGINS}`;

export const handle: Handle = async ({ event, resolve }) => {
  const { request, url, cookies } = event;
  const preview = cookies.get(PREVIEW_COOKIE) !== undefined;
  const cacheable = request.method === "GET" && !preview && !dev && !url.pathname.startsWith("/_app/");
  const key = url.pathname + url.search;

  if (cacheable) {
    const hit = getCached(key);
    if (hit) return hit;
  }

  let response = await resolve(event);

  // Redirects that editors manage in the admin, for paths that do not exist.
  if (response.status === 404 && request.method === "GET") {
    const target = await getContent(cookies)
      .resolveRedirect(url.pathname)
      .catch(() => null);
    if (target) redirect(target.permanent ? 301 : 302, target.new_path);
  }

  // A copy with headers that can be changed.
  response = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  // Images and video may come from the media origins. SvelteKit builds the
  // policy while it renders, so the directives are added to its header.
  const csp = response.headers.get("Content-Security-Policy");
  if (csp && !csp.includes("img-src")) {
    response.headers.set("Content-Security-Policy", `${csp.trim().replace(/;$/, "")}; ${MEDIA_DIRECTIVES};`);
  }
  if (preview) response.headers.set("Cache-Control", "private, no-store");

  const type = response.headers.get("Content-Type") ?? "";
  if (cacheable && response.status === 200 && CACHEABLE.test(type)) {
    response = await store(key, response);
  }
  return response;
};

/**
 * Errors of the site's code are logged, as SvelteKit does by default, and
 * go to Sentry with ERRORS=sentry. Errors such as a 404 are not.
 */
export const handleError: HandleServerError = async ({ kind, error, issues, event }) => {
  if (kind === "validation") console.error("Remote function schema validation failed:", issues);
  if (kind !== "unknown") return;
  console.error(error instanceof Error ? error.stack : String(error));
  await reportError(error, { request: event.request });
};

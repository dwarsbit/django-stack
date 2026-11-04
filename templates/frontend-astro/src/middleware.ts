import { defineMiddleware } from "astro:middleware";
import { getContent, PREVIEW_COOKIE } from "./lib/api";
import { getCached, store } from "./lib/cache";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const CACHEABLE = /^(text\/html|application\/xml|application\/rss\+xml|text\/plain)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies } = context;
  const preview = cookies.has(PREVIEW_COOKIE);
  const cacheable =
    request.method === "GET" && !preview && !import.meta.env.DEV && !url.pathname.startsWith("/_");
  const key = url.pathname + url.search;

  if (cacheable) {
    const hit = getCached(key);
    if (hit) return hit;
  }

  let response = await next();

  // Redirects that editors manage in the admin, for paths that do not exist.
  if (response.status === 404 && request.method === "GET") {
    const redirect = await getContent(cookies)
      .resolveRedirect(url.pathname)
      .catch(() => null);
    if (redirect) {
      return context.redirect(redirect.new_path, redirect.permanent ? 301 : 302);
    }
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!response.headers.has(name)) response.headers.set(name, value);
  }
  if (preview) response.headers.set("Cache-Control", "private, no-store");

  const type = response.headers.get("Content-Type") ?? "";
  if (cacheable && response.status === 200 && CACHEABLE.test(type)) {
    response = await store(key, response);
  }
  return response;
});

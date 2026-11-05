import { SITE_URL } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () =>
  new Response(`User-agent: *\nDisallow: /admin/\nDisallow: /preview\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

import { verifyWebhook } from "@django-stack/utils";
import type { APIRoute } from "astro";
import { purgeAll } from "../lib/cache";

/**
 * Django calls this after editors change content (REVALIDATE_URL), signed
 * with REVALIDATE_SECRET. It empties the page cache, so the next visit
 * renders the new content.
 */
export const POST: APIRoute = async ({ request }) => {
  const { valid, payload } = await verifyWebhook(request, process.env.REVALIDATE_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ detail: "Invalid signature." }), { status: 401 });
  }
  const purged = purgeAll();
  return new Response(JSON.stringify({ purged, changes: payload?.changes.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
};

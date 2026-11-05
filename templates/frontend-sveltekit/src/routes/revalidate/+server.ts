import { verifyWebhook } from "@django-stack/utils";
import { json } from "@sveltejs/kit";
import { purgeAll } from "#lib/server/cache.ts";
import type { RequestHandler } from "./$types";

/**
 * Django calls this after editors change content (REVALIDATE_URL), signed
 * with REVALIDATE_SECRET. It empties the page cache, so the next visit
 * renders the new content.
 */
export const POST: RequestHandler = async ({ request }) => {
  const { valid, payload } = await verifyWebhook(request, process.env.REVALIDATE_SECRET);
  if (!valid) return json({ detail: "Invalid signature." }, { status: 401 });
  const purged = purgeAll();
  return json({ purged, changes: payload?.changes.length ?? 0 });
};

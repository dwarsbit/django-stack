import { verifyWebhook } from "@django-stack/utils";

/**
 * Django calls this after editors change content (REVALIDATE_URL), signed
 * with REVALIDATE_SECRET. It empties the content cache, so the next visit
 * renders the new content.
 */
export default defineEventHandler(async (event) => {
  const { valid, payload } = await verifyWebhook(toWebRequest(event), process.env.REVALIDATE_SECRET);
  if (!valid) {
    setResponseStatus(event, 401);
    return { detail: "Invalid signature." };
  }
  return { purged: purgeAll(), changes: payload?.changes.length ?? 0 };
});

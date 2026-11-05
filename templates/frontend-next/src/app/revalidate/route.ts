import { revalidateHandler } from "@django-stack/next";

/**
 * Django calls this after editors change content (REVALIDATE_URL), signed
 * with REVALIDATE_SECRET. It expires the cached API responses, so the next
 * visit renders the new content.
 */
export const POST = revalidateHandler();

/**
 * Content access for load functions and endpoints. Server-side only: the API
 * key is read from API_READ_KEY, and SvelteKit never sends modules in
 * src/lib/server to the browser.
 */

import { createClient, createContent } from "@django-stack/utils";
import type { Cookies } from "@sveltejs/kit";
import type { Models } from "../headless";

export const PREVIEW_COOKIE = "stack_preview";

/** The content helpers, with drafts when the request carries a preview cookie. */
export function getContent(cookies: Cookies) {
  return createContent(getClient(cookies));
}

/** The typed Django Headless client, for queries the content helpers do not cover. */
export function getClient(cookies?: Cookies) {
  return createClient<Models>({ previewToken: cookies?.get(PREVIEW_COOKIE) ?? null });
}

export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** The page number of a list, from ?page=. */
export function pageNumber(url: URL): number {
  return Math.max(1, Number(url.searchParams.get("page")) || 1);
}

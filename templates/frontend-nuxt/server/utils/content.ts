/**
 * Content access for the server routes. The API key is read from
 * API_READ_KEY on the server; pages load content through the routes in
 * server/routes/_content, so the key never reaches the browser.
 */

import { createClient, createContent } from "@django-stack/utils";
import type { H3Event } from "h3";
import type { Models } from "../../src/lib/headless";

export const PREVIEW_COOKIE = "stack_preview";

export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function previewToken(event: H3Event): string | null {
  return getCookie(event, PREVIEW_COOKIE) ?? null;
}

/** The typed Django Headless client, with drafts when the request carries a preview cookie. */
export function getClient(event: H3Event) {
  return createClient<Models>({ previewToken: previewToken(event) });
}

/** The content helpers, with drafts when the request carries a preview cookie. */
export function getContent(event: H3Event) {
  return createContent(getClient(event));
}

/**
 * Content for a request, from the cache unless the request is a preview.
 * The key is the request's path and query.
 */
export function cachedContent<T>(event: H3Event, load: () => Promise<T>): Promise<T> {
  if (previewToken(event) || import.meta.dev) return load();
  return cached(event.path, load);
}

/** The page number of a list, from ?page=. */
export function pageNumber(event: H3Event): number {
  return Math.max(1, Number(getQuery(event).page) || 1);
}

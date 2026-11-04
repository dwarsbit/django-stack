/**
 * Content access for pages and endpoints. Server-side only: the API key is
 * read from API_READ_KEY and never reaches the browser.
 */

import { createClient, createContent } from "@django-stack/utils";
import type { AstroCookies } from "astro";
import type { Models } from "./headless";

export const PREVIEW_COOKIE = "stack_preview";

/** The content helpers, with drafts when the request carries a preview cookie. */
export function getContent(cookies: AstroCookies) {
  const previewToken = cookies.get(PREVIEW_COOKIE)?.value ?? null;
  const client = createClient<Models>({ previewToken });
  return createContent(client);
}

/** The typed Django Headless client, for queries the content helpers do not cover. */
export function getClient(cookies?: AstroCookies) {
  return createClient<Models>({ previewToken: cookies?.get(PREVIEW_COOKIE)?.value ?? null });
}

export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

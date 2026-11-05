/**
 * Content access for server components and route handlers. Server-side only:
 * the API key is read from API_READ_KEY, and `server-only` fails the build
 * if a client component imports this module.
 */
import "server-only";

import { contentFetchInit, PREVIEW_COOKIE, toMetadata } from "@django-stack/next";
import { createClient, createContent, type SeoInput, seo } from "@django-stack/utils";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import type { Models } from "./headless";

export { PREVIEW_COOKIE };

export const SITE_URL = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** The preview token, when the visitor opened a preview link. */
export async function previewToken(): Promise<string | null> {
  return (await cookies()).get(PREVIEW_COOKIE)?.value ?? null;
}

/**
 * The typed Django Headless client, for queries the content helpers do not
 * cover. Its responses are cached until Django calls /revalidate, except in
 * preview and in development.
 */
export async function getClient() {
  const token = await previewToken();
  return createClient<Models>({
    previewToken: token,
    init: contentFetchInit({ preview: token !== null || process.env.NODE_ENV === "development" }),
  });
}

/** The content helpers, with drafts when the visitor is in preview. */
export async function getContent() {
  return createContent(await getClient());
}

/** The page number of a list, from ?page=. */
export function pageNumber(page: string | string[] | undefined): number {
  return Math.max(1, Number(Array.isArray(page) ? page[0] : page) || 1);
}

/**
 * For a path that does not exist: follows a redirect editors manage in the
 * admin, or shows the not-found page.
 */
export async function notFoundOrRedirect(path: string): Promise<never> {
  const target = await (await getContent()).resolveRedirect(path).catch(() => null);
  if (target) (target.permanent ? permanentRedirect : redirect)(target.new_path);
  notFound();
}

/**
 * The metadata of a page: title, description, canonical URL and share image,
 * with the site settings as the fallback. `path` is the page's path.
 */
export async function pageMetadata(
  page: SeoInput | null | undefined,
  path: string,
  type: "website" | "article" = "website",
): Promise<Metadata> {
  const settings = await (await getContent()).getSiteSettings();
  const metadata = toMetadata(seo({ page, settings, siteUrl: SITE_URL, path, type }));
  // Next replaces the layout's alternates with the page's, so the feed is listed here.
  const feed = [{ url: "/rss.xml", title: settings?.site_name ?? "RSS" }];
  return { ...metadata, alternates: { ...metadata.alternates, types: { "application/rss+xml": feed } } };
}

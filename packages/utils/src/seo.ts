import { imageUrl } from "./media";
import type { Media, SiteSettings } from "./types";

export interface SeoInput {
  title?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  excerpt?: string | null;
  share_image?: Media | string | null;
  cover?: Media | string | null;
}

export interface Seo {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
}

/**
 * The head tags of a page: title, description, canonical URL, Open Graph
 * and Twitter fields. Empty fields fall back to the site settings.
 */
export function seo(options: {
  page?: SeoInput | null;
  settings?: SiteSettings | null;
  siteUrl: string;
  path: string;
  type?: "website" | "article";
}): Seo {
  const { page, settings } = options;
  const siteName = settings?.site_name ?? "";
  const pageTitle = page?.seo_title || page?.title || "";
  const title =
    pageTitle && siteName && pageTitle !== siteName ? `${pageTitle} | ${siteName}` : pageTitle || siteName;
  const description = page?.seo_description || page?.excerpt || settings?.seo_description || "";
  const canonical = new URL(options.path, options.siteUrl).toString();
  const image =
    imageUrl(page?.share_image, "share") ??
    imageUrl(page?.cover, "share") ??
    imageUrl(settings?.share_image, "share") ??
    null;

  const openGraph: Record<string, string> = {
    "og:title": pageTitle || siteName,
    "og:type": options.type ?? "website",
    "og:url": canonical,
  };
  if (siteName) openGraph["og:site_name"] = siteName;
  if (description) openGraph["og:description"] = description;
  if (image) openGraph["og:image"] = image;

  const twitter: Record<string, string> = { "twitter:card": image ? "summary_large_image" : "summary" };

  return { title, description, canonical, image, openGraph, twitter };
}

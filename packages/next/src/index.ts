import { CAPTCHA_CSP, type Seo, verifyPreviewToken, verifyWebhook } from "@django-stack/utils";
import type { Metadata } from "next";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { version } from "../package.json";

/** The version of this package, the same for every @django-stack package. */
export const VERSION: string = version;

/** The cookie that holds the preview token. */
export const PREVIEW_COOKIE = "stack_preview";

/** The cache tag of every API response, which /revalidate expires. */
export const CONTENT_TAG = "content";

type Env = Record<string, string | undefined>;
const env = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

/**
 * The `fetch` options of the API client. Responses go in Next's data cache
 * with the content tag, for `CACHE_TTL` seconds (default 300); in preview,
 * or with a TTL of 0, nothing is cached.
 */
export function contentFetchInit(options: { preview?: boolean; ttl?: number } = {}): RequestInit {
  const ttl = options.ttl ?? Number(env().CACHE_TTL ?? 300);
  if (options.preview || !(ttl > 0)) return { cache: "no-store" };
  return { cache: "force-cache", next: { tags: [CONTENT_TAG], revalidate: ttl } } as RequestInit;
}

/**
 * The POST handler of /revalidate. Django calls it after editors change
 * content, signed with REVALIDATE_SECRET; it expires the cached API
 * responses, so the next visit renders the new content.
 */
export function revalidateHandler(options: { secret?: string; tags?: string[] } = {}) {
  return async (request: Request): Promise<Response> => {
    const { valid, payload } = await verifyWebhook(request, options.secret ?? env().REVALIDATE_SECRET);
    if (!valid) return NextResponse.json({ detail: "Invalid signature." }, { status: 401 });
    const tags = options.tags ?? [CONTENT_TAG];
    for (const tag of tags) revalidateTag(tag, { expire: 0 });
    return NextResponse.json({ revalidated: tags, changes: payload?.changes.length ?? 0 });
  };
}

/** Only paths on this site, never another origin: browsers read `/\evil.com` as `//evil.com`. */
function localPath(path: string | null): string {
  return path && /^\/(?![/\\])/.test(path) ? path : "/";
}

/**
 * The GET handler of /preview. The admin's Preview button links here with a
 * token Django signed with PREVIEW_SECRET; the token is kept in a cookie
 * until it expires, and the API returns drafts while it is sent along.
 */
export function previewHandler(options: { secret?: string } = {}) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token || !(await verifyPreviewToken(options.secret ?? env().PREVIEW_SECRET, token))) {
      return new Response("The preview link is invalid or has expired.", { status: 401 });
    }
    const location = localPath(url.searchParams.get("path"));
    // A relative Location: the browser resolves it against the public URL.
    const response = new NextResponse(null, { status: 302, headers: { Location: location } });
    response.cookies.set(PREVIEW_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: (request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1)) === "https",
      expires: new Date(Number(token.split(".")[0]) * 1000),
    });
    return response;
  };
}

/** The GET handler of /preview/exit: removes the preview cookie. */
export function exitPreviewHandler() {
  return async (): Promise<Response> => {
    const response = new NextResponse(null, { status: 302, headers: { Location: "/" } });
    response.cookies.delete(PREVIEW_COOKIE);
    return response;
  };
}

/** Next's metadata from the head tags `seo()` of @django-stack/utils returns. */
export function toMetadata(tags: Seo): Metadata {
  const og = tags.openGraph;
  return {
    title: tags.title,
    description: tags.description || undefined,
    alternates: { canonical: tags.canonical },
    openGraph: {
      title: og["og:title"],
      description: og["og:description"],
      url: og["og:url"],
      siteName: og["og:site_name"],
      type: og["og:type"] === "article" ? "article" : "website",
      images: tags.image ? [tags.image] : undefined,
    },
    twitter: {
      card: tags.image ? "summary_large_image" : "summary",
      images: tags.image ? [tags.image] : undefined,
    },
  };
}

/** The origins of `MEDIA_ORIGINS`, a comma-separated list of URLs (S3 or a CDN). */
export function mediaOrigins(value = env().MEDIA_ORIGINS ?? ""): string[] {
  return value
    .split(",")
    .map((item) => {
      try {
        return new URL(item.trim()).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/**
 * A Content-Security-Policy with a nonce: Next adds it to the scripts it
 * renders. Images and video may also come from `mediaOrigins`.
 */
export function contentSecurityPolicy(options: {
  nonce: string;
  mediaOrigins?: string[];
  dev?: boolean;
  /** Allow the captcha widget: its solver, style and workers. */
  captcha?: boolean;
}) {
  const media = (options.mediaOrigins ?? []).map((origin) => ` ${origin}`).join("");
  const captcha = (directive: keyof typeof CAPTCHA_CSP) =>
    options.captcha ? CAPTCHA_CSP[directive].map((source) => ` ${source}`).join("") : "";
  return [
    "default-src 'self'",
    // React needs eval in development, for its error stacks.
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}${captcha("script-src")}`,
    // In development, styles are injected by the hot reloader.
    options.dev
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${options.nonce}'${captcha("style-src")}`,
    // Inline style attributes, such as the focal point of an image.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data:${media}`,
    `media-src 'self'${media}`,
    // The hot reloader's websocket in development.
    options.dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    ...(options.captcha ? [`worker-src${captcha("worker-src")}`] : []),
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Response headers for every page. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

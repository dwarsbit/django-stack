import { contentSecurityPolicy, mediaOrigins, PREVIEW_COOKIE, SECURITY_HEADERS } from "@django-stack/next";
import { type NextRequest, NextResponse } from "next/server";

const dev = process.env.NODE_ENV === "development";

// Django's paths. The reverse proxy sends them to Django in production; in
// development, this proxy does, so the site and the admin share an origin.
const BACKEND_PATHS = /^\/(admin|api|media|static)(\/|$)/;
const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
// Umami's tracker and page views, for page analytics; Caddy passes them on in production.
const TRACKER_PATHS = /^\/_a\/(script\.js|api\/send)$/;
const umami = process.env.UMAMI_URL || "http://umami:3000";
const media = mediaOrigins();

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (dev && BACKEND_PATHS.test(pathname)) {
    return NextResponse.rewrite(new URL(pathname + search, backend));
  }
  if (dev && TRACKER_PATHS.test(pathname)) {
    return NextResponse.rewrite(new URL(pathname.slice("/_a".length) + search, umami));
  }

  // A fresh nonce for every page: Next adds it to the scripts it renders.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy({ nonce, mediaOrigins: media, dev });
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  if (request.cookies.has(PREVIEW_COOKIE)) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Every path but Next's own files and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"],
};

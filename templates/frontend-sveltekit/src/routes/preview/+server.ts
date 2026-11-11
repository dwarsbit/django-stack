import { verifyPreviewToken } from "@django-stack/utils";
import { redirect } from "@sveltejs/kit";
import { PREVIEW_COOKIE } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types";

/**
 * Opens a page with drafts shown. The admin's Preview button links here with
 * a token Django signed with PREVIEW_SECRET; the token is kept in a cookie
 * and sent to the API with every request until it expires.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
  const token = url.searchParams.get("token");
  if (!(await verifyPreviewToken(process.env.PREVIEW_SECRET, token))) {
    return new Response("The preview link is invalid or has expired.", { status: 401 });
  }
  const expires = Number(token?.split(".")[0]);
  cookies.set(PREVIEW_COOKIE, token ?? "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    expires: new Date(expires * 1000),
  });
  const path = url.searchParams.get("path") ?? "/";
  // Only paths on this site, never another origin.
  redirect(302, /^\/(?![/\\])/.test(path) ? path : "/");
};

import { verifyPreviewToken } from "@django-stack/utils";

/**
 * Opens a page with drafts shown. The admin's Preview button links here with
 * a token Django signed with PREVIEW_SECRET; the token is kept in a cookie
 * and sent to the API with every request until it expires.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const token = typeof query.token === "string" ? query.token : null;
  if (!(await verifyPreviewToken(process.env.PREVIEW_SECRET, token))) {
    setResponseStatus(event, 401);
    return "The preview link is invalid or has expired.";
  }
  const expires = Number(token?.split(".")[0]);
  setCookie(event, PREVIEW_COOKIE, token ?? "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: getRequestProtocol(event) === "https",
    expires: new Date(expires * 1000),
  });
  const path = typeof query.path === "string" ? query.path : "/";
  // Only paths on this site, never another origin.
  return sendRedirect(event, path.startsWith("/") && !path.startsWith("//") ? path : "/", 302);
});

export default defineEventHandler((event) => {
  deleteCookie(event, PREVIEW_COOKIE, { path: "/" });
  return sendRedirect(event, "/", 302);
});

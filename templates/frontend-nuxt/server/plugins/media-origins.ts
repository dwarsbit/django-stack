/**
 * Images and video may come from the media origins (S3 or a CDN), which are
 * only known when the server starts: add them to the Content-Security-Policy
 * that nuxt.config.ts sets.
 */
export default defineNitroPlugin((nitroApp) => {
  const origins = (process.env.MEDIA_ORIGINS ?? "")
    .split(",")
    .map((value) => {
      try {
        return new URL(value.trim()).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (!origins.length) return;
  nitroApp.hooks.hook("nuxt-security:routeRules", (routeRules) => {
    const headers = routeRules["/**"]?.headers;
    const csp = headers ? headers.contentSecurityPolicy : undefined;
    if (!csp || typeof csp === "string") return;
    const sources = (value: unknown): string[] =>
      Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    csp["img-src"] = [...sources(csp["img-src"]), ...origins];
    csp["media-src"] = [...sources(csp["media-src"]), ...origins];
  });
});

export default defineEventHandler((event) => {
  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  return `User-agent: *\nDisallow: /admin/\nDisallow: /preview\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
});

export default defineEventHandler(async (event) => {
  const body = await cachedContent(event, async () => {
    const content = getContent(event);
    const [pages, posts, settings] = await Promise.all([
      content.getAllPages(),
      content.getAllPosts(),
      content.getSiteSettings(),
    ]);
    const urls = [
      { loc: "/", lastmod: null },
      { loc: "/blog", lastmod: null },
      ...pages
        .filter((page) => page.id !== settings?.home_page)
        .map((page) => ({ loc: `/${page.path}`, lastmod: page.published_at })),
      ...posts.map((post) => ({ loc: `/blog/${post.slug}`, lastmod: post.published_at })),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, lastmod }) =>
      `  <url><loc>${SITE_URL}${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
  });
  setResponseHeader(event, "Content-Type", "application/xml; charset=utf-8");
  return body;
});

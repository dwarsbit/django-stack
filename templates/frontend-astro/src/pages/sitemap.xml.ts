import type { APIRoute } from "astro";
import { getContent, SITE_URL } from "../lib/api";

export const GET: APIRoute = async ({ cookies }) => {
  const content = getContent(cookies);
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
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ loc, lastmod }) =>
      `  <url><loc>${SITE_URL}${loc}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};

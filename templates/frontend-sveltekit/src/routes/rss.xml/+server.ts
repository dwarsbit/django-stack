import { getContent, SITE_URL } from "#lib/server/api.ts";
import { rssFeed } from "#lib/server/rss.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ cookies }) => {
  const content = getContent(cookies);
  const [settings, posts] = await Promise.all([content.getSiteSettings(), content.getPosts({ limit: 20 })]);
  const body = rssFeed({
    title: settings?.site_name ?? "Blog",
    description: settings?.seo_description || settings?.tagline || "",
    site: SITE_URL,
    items: posts.data.map((post) => ({
      title: post.title,
      link: `/blog/${post.slug}`,
      description: post.excerpt,
      pubDate: post.published_at ? new Date(post.published_at) : null,
    })),
  });
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};

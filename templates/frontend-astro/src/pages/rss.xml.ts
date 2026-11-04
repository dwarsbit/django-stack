import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getContent, SITE_URL } from "../lib/api";

export const GET: APIRoute = async ({ cookies }) => {
  const content = getContent(cookies);
  const [settings, posts] = await Promise.all([content.getSiteSettings(), content.getPosts({ limit: 20 })]);
  return rss({
    title: settings?.site_name ?? "Blog",
    description: settings?.seo_description || settings?.tagline || "",
    site: SITE_URL,
    items: posts.data.map((post) => ({
      title: post.title,
      link: `/blog/${post.slug}`,
      description: post.excerpt,
      ...(post.published_at ? { pubDate: new Date(post.published_at) } : {}),
    })),
  });
};

export default defineEventHandler(async (event) => {
  const body = await cachedContent(event, async () => {
    const content = getContent(event);
    const [settings, posts] = await Promise.all([content.getSiteSettings(), content.getPosts({ limit: 20 })]);
    return rssFeed({
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
  });
  setResponseHeader(event, "Content-Type", "application/rss+xml; charset=utf-8");
  return body;
});

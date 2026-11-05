/** The home page set in the site settings, or else the latest posts. */
export default defineEventHandler((event) =>
  cachedContent(event, async () => {
    const content = getContent(event);
    const settings = await content.getSiteSettings();
    const home = await content.getHomePage(settings);
    const posts = home ? null : await content.getPosts({ limit: 9 });
    return { settings, home, posts };
  }),
);

/** What every page shows: the site settings and the menus. */
export default defineEventHandler(async (event) => {
  const data = await cachedContent(event, async () => {
    const content = getContent(event);
    const [settings, mainMenu, footerMenu] = await Promise.all([
      content.getSiteSettings(),
      content.getMenu("main"),
      content.getMenu("footer"),
    ]);
    return { settings, mainMenu, footerMenu, siteUrl: SITE_URL };
  });
  return {
    ...data,
    preview: previewToken(event) !== null,
    // Page analytics: Umami's tracker, served from this site at /_a/.
    analytics: process.env.UMAMI_WEBSITE_ID || null,
  };
});

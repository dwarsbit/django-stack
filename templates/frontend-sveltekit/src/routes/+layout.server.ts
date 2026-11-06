import { getContent, PREVIEW_COOKIE, SITE_URL } from "#lib/server/api.ts";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ cookies }) => {
  const content = getContent(cookies);
  const [settings, mainMenu, footerMenu] = await Promise.all([
    content.getSiteSettings(),
    content.getMenu("main"),
    content.getMenu("footer"),
  ]);
  return {
    settings,
    mainMenu,
    footerMenu,
    preview: cookies.get(PREVIEW_COOKIE) !== undefined,
    siteUrl: SITE_URL,
    // Page analytics: Umami's tracker, served from this site at /_a/.
    analytics: process.env.UMAMI_WEBSITE_ID || null,
  };
};

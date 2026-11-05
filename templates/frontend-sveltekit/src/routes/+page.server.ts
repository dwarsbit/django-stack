import { getContent } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const content = getContent(cookies);
  const settings = await content.getSiteSettings();
  const home = await content.getHomePage(settings);
  const posts = home ? null : await content.getPosts({ limit: 9 });
  return { home, posts, seo: home };
};

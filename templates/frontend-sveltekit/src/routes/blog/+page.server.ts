import { getContent, pageNumber } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const result = await getContent(cookies).getPosts({ page: pageNumber(url), limit: 9 });
  return { result, seo: { title: "Blog" } };
};

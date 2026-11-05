import { error } from "@sveltejs/kit";
import { getContent, pageNumber } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, url }) => {
  const content = getContent(cookies);
  const tag = await content.getTag(params.slug);
  if (!tag) error(404, "Page not found");
  const result = await content.getPosts({ tag: params.slug, page: pageNumber(url), limit: 9 });
  return { tag, result, seo: { title: `#${tag.name}` } };
};

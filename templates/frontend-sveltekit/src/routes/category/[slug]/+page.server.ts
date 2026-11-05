import { error } from "@sveltejs/kit";
import { getContent, pageNumber } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies, url }) => {
  const content = getContent(cookies);
  const category = await content.getCategory(params.slug);
  if (!category) error(404, "Page not found");
  const result = await content.getPosts({ category: params.slug, page: pageNumber(url), limit: 9 });
  return { category, result, seo: { title: category.name, seo_description: category.description ?? "" } };
};

import { error } from "@sveltejs/kit";
import { getContent } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const post = await getContent(cookies).getPost(params.slug);
  if (!post) error(404, "Page not found");
  return { post, seo: post, seoType: "article" as const };
};

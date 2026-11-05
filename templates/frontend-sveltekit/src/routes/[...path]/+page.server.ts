import { error } from "@sveltejs/kit";
import { getContent } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const page = await getContent(cookies).getPage(params.path);
  if (!page) error(404, "Page not found");
  return { page, seo: page };
};

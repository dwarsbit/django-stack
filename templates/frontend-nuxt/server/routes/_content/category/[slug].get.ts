/** A category and a page of its posts. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug") ?? "";
  const data = await cachedContent(event, async () => {
    const content = getContent(event);
    const category = await content.getCategory(slug);
    if (!category) return null;
    const result = await content.getPosts({ category: slug, page: pageNumber(event), limit: 9 });
    return { category, result };
  });
  if (!data) throw createError({ statusCode: 404, statusMessage: "Page not found" });
  return data;
});

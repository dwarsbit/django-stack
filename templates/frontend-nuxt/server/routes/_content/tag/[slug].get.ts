/** A tag and a page of its posts. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug") ?? "";
  const data = await cachedContent(event, async () => {
    const content = getContent(event);
    const tag = await content.getTag(slug);
    if (!tag) return null;
    const result = await content.getPosts({ tag: slug, page: pageNumber(event), limit: 9 });
    return { tag, result };
  });
  if (!data) throw createError({ statusCode: 404, statusMessage: "Page not found" });
  return data;
});

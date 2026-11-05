/** A page by its path, such as about/team. */
export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? "");
  const page = await cachedContent(event, () => getContent(event).getPage(path));
  if (!page) throw createError({ statusCode: 404, statusMessage: "Page not found" });
  return page;
});

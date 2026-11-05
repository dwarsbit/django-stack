/** A post by its slug. */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, "slug") ?? "";
  const post = await cachedContent(event, () => getContent(event).getPost(slug));
  if (!post) throw createError({ statusCode: 404, statusMessage: "Page not found" });
  return post;
});

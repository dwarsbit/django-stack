/** The redirect an editor set up in the admin for a path, if any. */
export default defineEventHandler(async (event) => {
  const path = String(getQuery(event).path ?? "/");
  const redirect = await cachedContent(event, () => getContent(event).resolveRedirect(path));
  if (!redirect) throw createError({ statusCode: 404, statusMessage: "No redirect" });
  return { new_path: redirect.new_path, permanent: redirect.permanent };
});

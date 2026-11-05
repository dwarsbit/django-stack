/** A page of posts, newest first. */
export default defineEventHandler((event) =>
  cachedContent(event, () => getContent(event).getPosts({ page: pageNumber(event), limit: 9 })),
);

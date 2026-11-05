import type { Paginated, Post } from "@django-stack/utils";
import Link from "next/link";
import { PostCard } from "./PostCard";

/** A page of posts, with links to the newer and older pages. `base` is the URL of the list. */
export function PostList({ result, base }: { result: Paginated<Post>; base: string }) {
  const { current, pages } = result.pagination;
  const pageUrl = (page: number) => (page === 1 ? base : `${base}?page=${page}`);
  return (
    <>
      {result.data.length === 0 ? <p className="muted">No posts yet.</p> : null}
      <div className="grid">
        {result.data.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
      {pages > 1 ? (
        <nav className="pagination" aria-label="Pages">
          {current > 1 ? <Link href={pageUrl(current - 1)}>← Newer</Link> : null}
          <span className="muted">
            Page {current} of {pages}
          </span>
          {current < pages ? <Link href={pageUrl(current + 1)}>Older →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}

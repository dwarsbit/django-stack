import { Image } from "@django-stack/react";
import type { Author, Post } from "@django-stack/utils";
import Link from "next/link";

export function PostCard({ post }: { post: Post }) {
  const author = typeof post.author === "object" ? (post.author as Author | null) : null;
  const date = post.published_at ? new Date(post.published_at) : null;
  return (
    <article className="card">
      <Link href={`/blog/${post.slug}`}>
        <Image media={post.cover} size="card" sizes="(min-width: 40rem) 22rem, 100vw" className="cover" />
      </Link>
      <h3>
        <Link href={`/blog/${post.slug}`}>{post.title}</Link>
      </h3>
      <p className="muted meta">
        {date ? (
          <time dateTime={date.toISOString()}>{date.toLocaleDateString("en", { dateStyle: "medium" })}</time>
        ) : null}
        {author ? <span> · {author.name}</span> : null}
      </p>
      {post.excerpt ? <p>{post.excerpt}</p> : null}
    </article>
  );
}

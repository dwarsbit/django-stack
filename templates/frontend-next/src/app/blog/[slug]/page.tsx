import { Blocks, Image } from "@django-stack/react";
import type { Author, Taxonomy } from "@django-stack/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { getContent, notFoundOrRedirect, pageMetadata } from "@/lib/api";

type Props = { params: Promise<{ slug: string }> };

async function load(params: Props["params"]) {
  const { slug } = await params;
  return { slug, post: await (await getContent()).getPost(slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, post } = await load(params);
  return post ? pageMetadata(post, `/blog/${slug}`, "article") : {};
}

export default async function BlogPost({ params }: Props) {
  const { slug, post } = await load(params);
  if (!post) return notFoundOrRedirect(`/blog/${slug}`);
  const author = typeof post.author === "object" ? (post.author as Author | null) : null;
  const categories = post.categories.filter((item): item is Taxonomy => typeof item === "object");
  const tags = post.tags.filter((item): item is Taxonomy => typeof item === "object");
  const date = post.published_at ? new Date(post.published_at) : null;
  return (
    <article className="narrow">
      <p className="muted">
        {date ? (
          <time dateTime={date.toISOString()}>{date.toLocaleDateString("en", { dateStyle: "long" })}</time>
        ) : null}
        {author ? <span> · {author.name}</span> : null}
        {categories.map((category) => (
          <span key={category.slug}>
            {" · "}
            <Link href={`/category/${category.slug}`}>{category.name}</Link>
          </span>
        ))}
      </p>
      <h1>{post.title}</h1>
      <Image
        media={post.cover}
        size="content"
        sizes="(min-width: 48rem) 44rem, 100vw"
        className="post-cover"
        eager
      />
      <Blocks blocks={post.body} />
      {tags.length > 0 ? (
        <p className="tags">
          {tags.map((tag) => (
            <Link key={tag.slug} href={`/tag/${tag.slug}`}>
              #{tag.name}
            </Link>
          ))}
        </p>
      ) : null}
    </article>
  );
}

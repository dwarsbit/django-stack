import type { Metadata } from "next";
import { PostList } from "@/components/PostList";
import { getContent, pageMetadata, pageNumber } from "@/lib/api";

type Props = { searchParams: Promise<{ page?: string }> };

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({ title: "Blog" }, "/blog");
}

export default async function Blog({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page);
  const result = await (await getContent()).getPosts({ page, limit: 9 });
  return (
    <section className="container">
      <h1>Blog</h1>
      <PostList result={result} base="/blog" />
    </section>
  );
}

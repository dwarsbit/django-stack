import type { Metadata } from "next";
import { PostList } from "@/components/PostList";
import { getContent, notFoundOrRedirect, pageMetadata, pageNumber } from "@/lib/api";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

async function load(params: Props["params"]) {
  const { slug } = await params;
  return { slug, tag: await (await getContent()).getTag(slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, tag } = await load(params);
  return tag ? pageMetadata({ title: `#${tag.name}` }, `/tag/${slug}`) : {};
}

export default async function Tag({ params, searchParams }: Props) {
  const { slug, tag } = await load(params);
  if (!tag) return notFoundOrRedirect(`/tag/${slug}`);
  const page = pageNumber((await searchParams).page);
  const result = await (await getContent()).getPosts({ tag: slug, page, limit: 9 });
  return (
    <section className="container">
      <p className="muted">Tag</p>
      <h1>#{tag.name}</h1>
      <PostList result={result} base={`/tag/${slug}`} />
    </section>
  );
}

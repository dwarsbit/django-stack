import type { Metadata } from "next";
import { PostList } from "@/components/PostList";
import { getContent, notFoundOrRedirect, pageMetadata, pageNumber } from "@/lib/api";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

async function load(params: Props["params"]) {
  const { slug } = await params;
  return { slug, category: await (await getContent()).getCategory(slug) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, category } = await load(params);
  if (!category) return {};
  return pageMetadata(
    { title: category.name, seo_description: category.description ?? "" },
    `/category/${slug}`,
  );
}

export default async function Category({ params, searchParams }: Props) {
  const { slug, category } = await load(params);
  if (!category) return notFoundOrRedirect(`/category/${slug}`);
  const page = pageNumber((await searchParams).page);
  const result = await (await getContent()).getPosts({ category: slug, page, limit: 9 });
  return (
    <section className="container">
      <p className="muted">Category</p>
      <h1>{category.name}</h1>
      {category.description ? <p>{category.description}</p> : null}
      <PostList result={result} base={`/category/${slug}`} />
    </section>
  );
}

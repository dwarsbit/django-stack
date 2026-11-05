import { Blocks } from "@django-stack/react";
import type { Metadata } from "next";
import { PostList } from "@/components/PostList";
import { getContent, pageMetadata } from "@/lib/api";

async function load() {
  const content = await getContent();
  const settings = await content.getSiteSettings();
  return { settings, home: await content.getHomePage(settings), content };
}

export async function generateMetadata(): Promise<Metadata> {
  const { home } = await load();
  return pageMetadata(home, "/");
}

export default async function Home() {
  const { settings, home, content } = await load();
  if (home) {
    return (
      <article className="narrow">
        <h1>{home.title}</h1>
        <Blocks blocks={home.body} />
      </article>
    );
  }
  const posts = await content.getPosts({ limit: 9 });
  return (
    <section className="container">
      <h1>{settings?.site_name ?? "Latest posts"}</h1>
      {settings?.tagline ? <p className="muted">{settings.tagline}</p> : null}
      <PostList result={posts} base="/" />
    </section>
  );
}

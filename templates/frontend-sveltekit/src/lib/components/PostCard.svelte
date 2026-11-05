<script lang="ts">
  import { Image } from "@django-stack/svelte";
  import type { Author, Post } from "@django-stack/utils";

  let { post }: { post: Post } = $props();
  const author = $derived(typeof post.author === "object" ? (post.author as Author | null) : null);
  const date = $derived(post.published_at ? new Date(post.published_at) : null);
</script>

<article class="card">
  <a href="/blog/{post.slug}">
    <Image media={post.cover} size="card" sizes="(min-width: 40rem) 22rem, 100vw" class="cover" />
  </a>
  <h3><a href="/blog/{post.slug}">{post.title}</a></h3>
  <p class="muted meta">
    {#if date}<time datetime={date.toISOString()}>{date.toLocaleDateString("en", { dateStyle: "medium" })}</time>{/if}
    {#if author}<span> · {author.name}</span>{/if}
  </p>
  {#if post.excerpt}<p>{post.excerpt}</p>{/if}
</article>

<style>
  .card h3 {
    margin: 0.75rem 0 0.25rem;
    line-height: 1.3;
  }
  .card h3 a {
    color: inherit;
    text-decoration: none;
  }
  .card :global(.cover) {
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    border-radius: 0.5rem;
  }
  .meta {
    font-size: 0.9rem;
    margin: 0;
  }
</style>

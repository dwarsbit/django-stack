<script lang="ts">
  import { Blocks, Image } from "@django-stack/svelte";
  import type { Author, Taxonomy } from "@django-stack/utils";

  let { data } = $props();
  const post = $derived(data.post);
  const author = $derived(typeof post.author === "object" ? (post.author as Author | null) : null);
  const categories = $derived(post.categories.filter((item): item is Taxonomy => typeof item === "object"));
  const tags = $derived(post.tags.filter((item): item is Taxonomy => typeof item === "object"));
  const date = $derived(post.published_at ? new Date(post.published_at) : null);
</script>

<article class="narrow">
  <p class="muted">
    {#if date}<time datetime={date.toISOString()}>{date.toLocaleDateString("en", { dateStyle: "long" })}</time>{/if}
    {#if author}<span> · {author.name}</span>{/if}
    {#each categories as category (category.slug)}
      <span> · <a href="/category/{category.slug}">{category.name}</a></span>
    {/each}
  </p>
  <h1>{post.title}</h1>
  <Image media={post.cover} size="content" sizes="(min-width: 48rem) 44rem, 100vw" class="cover" eager />
  <Blocks blocks={post.body} />
  {#if tags.length > 0}
    <p class="tags">
      {#each tags as tag (tag.slug)}<a href="/tag/{tag.slug}">#{tag.name}</a>{/each}
    </p>
  {/if}
</article>

<style>
  article :global(.cover) {
    width: 100%;
    border-radius: 0.75rem;
  }
  .tags {
    display: flex;
    gap: 1rem;
    margin-top: 3rem;
  }
</style>

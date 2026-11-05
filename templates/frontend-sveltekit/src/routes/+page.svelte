<script lang="ts">
  import PostList from "#lib/components/PostList.svelte";
  import { Blocks } from "@django-stack/svelte";

  let { data } = $props();
</script>

{#if data.home}
  <article class="narrow">
    <h1>{data.home.title}</h1>
    <Blocks blocks={data.home.body} />
  </article>
{:else}
  <section class="container">
    <h1>{data.settings?.site_name ?? "Latest posts"}</h1>
    {#if data.settings?.tagline}<p class="muted">{data.settings.tagline}</p>{/if}
    {#if data.posts}<PostList result={data.posts} base="/" />{/if}
  </section>
{/if}

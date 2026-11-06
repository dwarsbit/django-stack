<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { Image, RichText, Seo } from "@django-stack/svelte";
  import { linkHref } from "@django-stack/utils";

  let { data, children } = $props();
  const path = $derived(page.url.pathname);
  const seo = $derived(
    page.error ? { title: page.status === 404 ? "Page not found" : "Something went wrong" } : page.data.seo,
  );
</script>

<svelte:head>
  <link rel="alternate" type="application/rss+xml" title={data.settings?.site_name ?? "RSS"} href="/rss.xml" />
  {#if data.analytics}
    <script defer src="/_a/script.js" data-website-id={data.analytics}></script>
  {/if}
</svelte:head>

<Seo
  page={seo ?? null}
  type={page.data.seoType}
  settings={data.settings}
  siteUrl={data.siteUrl}
  path={path}
/>

{#if data.preview}
  <div class="preview-banner">
    Preview: drafts are shown. <a href="/preview/exit" data-sveltekit-reload>Leave preview</a>
  </div>
{/if}
<header class="site-header">
  <div class="container bar">
    <a class="brand" href="/">
      {#if data.settings?.logo}
        <Image media={data.settings.logo} size="thumbnail" alt={data.settings.site_name} eager />
      {:else}
        {data.settings?.site_name}
      {/if}
    </a>
    <nav aria-label="Main">
      {#each data.mainMenu?.items ?? [] as item (item.id)}
        {@const href = linkHref(item)}
        <a {href} aria-current={href === path || (href !== "/" && path.startsWith(`${href}/`)) ? "page" : undefined}>
          {item.value.label}
        </a>
      {/each}
    </nav>
  </div>
</header>
<main>
  {@render children()}
</main>
<footer class="site-footer">
  <div class="container bar muted">
    <RichText html={data.settings?.footer_text} class="footer-text" />
    <nav aria-label="Footer">
      {#each data.footerMenu?.items ?? [] as item (item.id)}
        <a href={linkHref(item)}>{item.value.label}</a>
      {/each}
      {#each Object.entries(data.settings?.social_links ?? {}) as [name, url] (name)}
        <a href={url} rel="me">{name}</a>
      {/each}
    </nav>
  </div>
</footer>

<style>
  .site-header {
    border-bottom: 1px solid var(--color-line);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding-block: 1rem;
  }
  .brand {
    font-weight: 700;
    font-size: 1.2rem;
    color: inherit;
    text-decoration: none;
  }
  .brand :global(img) {
    height: 2.5rem;
    width: auto;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
  }
  nav a {
    text-decoration: none;
  }
  nav a[aria-current="page"] {
    font-weight: 600;
    text-decoration: underline;
  }
  main {
    min-height: 70vh;
    padding-block: 2rem 4rem;
  }
  .site-footer {
    border-top: 1px solid var(--color-line);
    font-size: 0.9rem;
  }
  .site-footer :global(.footer-text p) {
    margin: 0;
  }
</style>

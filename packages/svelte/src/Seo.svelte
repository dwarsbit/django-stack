<script lang="ts">
  import { type SeoInput, type SiteSettings, seo } from "@django-stack/utils";

  interface Props {
    page?: SeoInput | null;
    settings: SiteSettings | null;
    /** The site's public URL, such as https://example.com. */
    siteUrl: string;
    /** The path of the page, for the canonical URL. */
    path: string;
    type?: "website" | "article";
  }

  let { page, settings, siteUrl, path, type }: Props = $props();
  const meta = $derived(seo({ page, settings, siteUrl, path, type }));
</script>

<svelte:head>
  <title>{meta.title}</title>
  {#if meta.description}
    <meta name="description" content={meta.description} />
  {/if}
  <link rel="canonical" href={meta.canonical} />
  {#each Object.entries(meta.openGraph) as [property, content] (property)}
    <meta {property} {content} />
  {/each}
  {#each Object.entries(meta.twitter) as [name, content] (name)}
    <meta {name} {content} />
  {/each}
</svelte:head>

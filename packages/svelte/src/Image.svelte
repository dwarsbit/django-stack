<script lang="ts">
  import { imageAttributes, type Media } from "@django-stack/utils";

  interface Props {
    media: Media | string | null | undefined;
    /** An image size from IMAGE_SIZES, such as card or hero. */
    size?: string;
    /** The sizes attribute, for the browser to pick from the srcset. */
    sizes?: string;
    alt?: string;
    class?: string;
    eager?: boolean;
  }

  let { media, size, sizes = "100vw", alt, class: className, eager = false }: Props = $props();
  const attributes = $derived(imageAttributes(media, { size, alt }));
</script>

{#if attributes}
  <img
    src={attributes.src}
    srcset={attributes.srcset}
    sizes={attributes.srcset ? sizes : undefined}
    width={attributes.width}
    height={attributes.height}
    alt={attributes.alt}
    class={className}
    style:object-position={attributes.objectPosition}
    loading={eager ? "eager" : "lazy"}
    decoding="async"
  />
{/if}

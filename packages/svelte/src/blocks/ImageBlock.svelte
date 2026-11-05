<script lang="ts">
  import type { ImageBlock } from "@django-stack/utils";
  import Image from "../Image.svelte";

  let { block }: { block: ImageBlock } = $props();
</script>

<figure class="block-image">
  <Image media={block.value.image} size="content" sizes="(min-width: 48rem) 44rem, 100vw" />
  {#if block.value.caption}
    <figcaption class="muted">{block.value.caption}</figcaption>
  {/if}
</figure>

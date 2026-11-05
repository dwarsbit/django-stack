<script lang="ts">
  import type { CallToActionBlock } from "@django-stack/utils";

  let { block }: { block: CallToActionBlock } = $props();
</script>

<aside class="cta">
  <h2>{block.value.title}</h2>
  {#if block.value.text}
    <p>{block.value.text}</p>
  {/if}
  <a class="button" href={block.value.button_url}>{block.value.button_label}</a>
</aside>

<script lang="ts">
  import type { QuoteBlock } from "@django-stack/utils";

  let { block }: { block: QuoteBlock } = $props();
</script>

<blockquote class="prose">
  <p>{block.value.text}</p>
  {#if block.value.attribution}
    <footer class="muted">{block.value.attribution}</footer>
  {/if}
</blockquote>

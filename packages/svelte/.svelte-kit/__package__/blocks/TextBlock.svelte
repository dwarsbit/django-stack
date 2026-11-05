<script lang="ts">
  import type { TextBlock } from "@django-stack/utils";
  import RichText from "../RichText.svelte";

  let { block }: { block: TextBlock } = $props();
</script>

<RichText html={block.value.body} />

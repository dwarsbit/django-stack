<!--
  HTML from a Content Studio HTMLField. Django sanitizes it with an
  allowlist when it is saved, so it is safe to render as is.
-->
<script lang="ts">
  interface Props {
    html: string | null | undefined;
    class?: string;
  }

  let { html, class: className = "prose" }: Props = $props();
</script>

{#if html}
  <div class={className}>{@html html}</div>
{/if}

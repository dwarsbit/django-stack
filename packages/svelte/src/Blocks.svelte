<!--
  Renders a Content Studio block field. `components` maps a block type to a
  component that takes a `block` prop; it adds types or replaces the
  built-in ones. Unknown types render nothing.
-->
<script lang="ts">
  import type { Block } from "@django-stack/utils";
  import type { Component } from "svelte";
  import CallToActionBlock from "./blocks/CallToActionBlock.svelte";
  import ImageBlock from "./blocks/ImageBlock.svelte";
  import QuoteBlock from "./blocks/QuoteBlock.svelte";
  import TextBlock from "./blocks/TextBlock.svelte";

  interface Props {
    blocks: Block[] | null | undefined;
    components?: Record<string, Component<{ block: any }>>;
  }

  let { blocks, components = {} }: Props = $props();

  const registry = $derived<Record<string, Component<{ block: any }>>>({
    text: TextBlock,
    image: ImageBlock,
    quote: QuoteBlock,
    call_to_action: CallToActionBlock,
    ...components,
  });
</script>

{#each blocks ?? [] as block (block.id)}
  {@const BlockComponent = registry[block.type]}
  {#if BlockComponent}
    <BlockComponent {block} />
  {/if}
{/each}

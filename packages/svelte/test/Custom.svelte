<script lang="ts">
  let { block }: { block: { value: { title: string } } } = $props();
</script>

<p>Gallery: {block.value.title}</p>

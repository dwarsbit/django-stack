<script lang="ts">
  import ContactForm from "#lib/components/ContactForm.svelte";
  import { Blocks } from "@django-stack/svelte";

  let { data } = $props();
</script>

<article class="narrow">
  <h1>{data.page.title}</h1>
  <Blocks blocks={data.page.body} />
  {#if data.page.path === "contact"}<ContactForm />{/if}
</article>

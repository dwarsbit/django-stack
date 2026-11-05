<script lang="ts">
  import { page } from "$app/state";
</script>

<section class="narrow">
  {#if page.status === 404}
    <h1>Page not found</h1>
    <p>The page you are looking for does not exist or has moved.</p>
  {:else}
    <h1>Something went wrong</h1>
    <p>The page could not be shown. Try again in a moment.</p>
  {/if}
  <p><a href="/">Go to the home page</a></p>
</section>

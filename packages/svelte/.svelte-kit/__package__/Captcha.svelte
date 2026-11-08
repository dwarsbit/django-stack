<!--
  The captcha widget, for a form that posts to a route in PUBLIC_CREATE: it
  adds a hidden `captcha` field with the token once the visitor verified.
  After a submission, call `resetCaptcha(form)` from @django-stack/utils: a
  token is valid once.
-->
<script lang="ts">
  import { CAPTCHA_ENDPOINT, CAPTCHA_FIELD, loadCaptcha } from "@django-stack/utils";
  import { onMount } from "svelte";

  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();

  onMount(() => {
    void loadCaptcha();
  });
</script>

<cap-widget class={className} data-cap-api-endpoint={CAPTCHA_ENDPOINT} data-cap-hidden-field-name={CAPTCHA_FIELD}
></cap-widget>

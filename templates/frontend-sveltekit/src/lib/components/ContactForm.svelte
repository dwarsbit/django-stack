<!--
  The contact form. It posts to Django's public create route for form
  submissions (PUBLIC_CREATE in backend/config/settings.py), which is rate
  limited per IP address and, unless CAPTCHA=off, needs the token of the
  captcha widget. Submissions appear in the admin.
-->
<script lang="ts">
  import { Captcha } from "@django-stack/svelte";
  import { resetCaptcha } from "@django-stack/utils";

  let { captcha = true }: { captcha?: boolean } = $props();
  let status = $state("");
  let sending = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    sending = true;
    status = "Sending…";
    try {
      const response = await fetch("/api/content.formsubmission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (response.status === 429) throw new Error("Too many messages; try again in a minute.");
      if (!response.ok) {
        const errors = await response.json().catch(() => ({}));
        // A token is valid once, so the widget verifies again.
        resetCaptcha(form);
        if (errors.captcha) throw new Error("Verify that you are human, then send the message again.");
        throw new Error("The message could not be sent. Check the fields and try again.");
      }
      form.reset();
      resetCaptcha(form);
      status = "Thank you, your message was sent.";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      sending = false;
    }
  }
</script>

<form class="contact-form" onsubmit={submit}>
  <label>Name <input name="name" required maxlength="200" autocomplete="name" /></label>
  <label>Email <input name="email" type="email" required autocomplete="email" /></label>
  <label>Message <textarea name="message" required maxlength="5000" rows="6"></textarea></label>
  {#if captcha}<Captcha />{/if}
  <button class="button" type="submit" disabled={sending}>Send</button>
  <p class="status" role="status" aria-live="polite">{status}</p>
</form>

<style>
  .contact-form {
    display: grid;
    gap: 1rem;
    max-width: 32rem;
    margin-top: 2rem;
  }
  label {
    display: grid;
    gap: 0.25rem;
    font-weight: 600;
  }
  input,
  textarea {
    font: inherit;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-line);
    border-radius: 0.375rem;
    background: transparent;
    color: inherit;
  }
  button {
    justify-self: start;
  }
</style>

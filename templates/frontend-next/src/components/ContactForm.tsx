"use client";

/**
 * The contact form. It posts to Django's public create route for form
 * submissions (PUBLIC_CREATE in backend/config/settings.py), which is rate
 * limited per IP address and, unless CAPTCHA=off, needs the token of the
 * captcha widget. Submissions appear in the admin.
 */
import { Captcha } from "@django-stack/react";
import { resetCaptcha } from "@django-stack/utils";
import { type FormEvent, useState } from "react";

export function ContactForm({ captcha = true }: { captcha?: boolean }) {
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    setStatus("Sending…");
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
      setStatus("Thank you, your message was sent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <label>
        Name <input name="name" required maxLength={200} autoComplete="name" />
      </label>
      <label>
        Email <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Message <textarea name="message" required maxLength={5000} rows={6} />
      </label>
      {captcha ? <Captcha /> : null}
      <button className="button" type="submit" disabled={sending}>
        Send
      </button>
      <p className="status" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

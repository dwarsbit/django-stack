"use client";

/**
 * The contact form. It posts to Django's public create route for form
 * submissions (PUBLIC_CREATE in backend/config/settings.py), which is rate
 * limited per IP address. Submissions appear in the admin.
 */
import { type FormEvent, useState } from "react";

export function ContactForm() {
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
      if (!response.ok) throw new Error("The message could not be sent. Check the fields and try again.");
      form.reset();
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
      <button className="button" type="submit" disabled={sending}>
        Send
      </button>
      <p className="status" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

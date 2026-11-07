---
sidebar_position: 8
---

# 🧩 Captcha

The contact form asks the visitor's browser to solve a proof of work before
it sends a message: a few hundred milliseconds of hashing that costs a
person nothing and a spammer sending thousands of messages a lot. There is
no puzzle to click through, no third party and no tracking. `init` turns it
on unless you pass `--captcha off`.

The captcha speaks the [Cap](https://capjs.js.org) protocol. Django serves
it, so nothing runs in an extra container, and the frontend shows Cap's
`<cap-widget>` web component.

## What `init` sets up

- **The app**: `django_stack.contrib.captcha` in `INSTALLED_APPS` in
  `backend/config/settings.py`. It serves the protocol at `/api/cap/` and
  keeps open challenges and unused tokens in two tables of the database,
  deleting expired ones as new challenges come in.
- **The check**: every create of a model in `PUBLIC_CREATE`, such as the
  contact form's `content.formsubmission`, needs a `captcha` field with a
  token from the widget. Requests with an API key or from a staff user need
  none. Without a valid token the API answers `400` with an error on
  `captcha`; a token is valid once, for 20 minutes.
- **The widget** in the contact form, from the `Captcha` component of
  `@django-stack/react`, `@django-stack/vue` or `@django-stack/svelte`
  (Astro uses the element directly). It loads its WebAssembly solver from
  `/api/cap/solver.wasm` on the site, not from a CDN.
- **The Content-Security-Policy** of the frontend allows the widget:
  `'wasm-unsafe-eval'` for the solver, `worker-src 'self' blob:` for its
  workers and the hash of its style. `CAPTCHA_CSP` in `@django-stack/utils`
  has these sources.

## Protect your own forms

For a form that posts to a model in `PUBLIC_CREATE`, add the widget inside
the `<form>`; it puts the token in a hidden `captcha` field.

```tsx title="frontend/src/components/SignupForm.tsx"
"use client";

import { Captcha } from "@django-stack/react";
import { resetCaptcha } from "@django-stack/utils";
import type { FormEvent } from "react";

export function SignupForm() {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await fetch("/api/content.signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    // A token is valid once: the visitor verifies again for the next one.
    resetCaptcha(form);
  }

  return (
    <form onSubmit={submit}>
      <input name="email" type="email" required />
      <Captcha />
      <button type="submit">Sign up</button>
    </form>
  );
}
```

For a view or serializer of your own, use `CaptchaField` or
`verify_captcha`:

```python title="backend/content/serializers.py"
from django_stack.contrib.captcha.fields import CaptchaField
from rest_framework import serializers


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    captcha = CaptchaField()
```

```python
from django_stack.contrib.captcha import verify_captcha

if not verify_captcha(request.POST.get("captcha")):
    ...
```

In tests, `captcha_token()` from `django_stack.contrib.captcha.testing`
returns a valid token.

## Settings

| Setting | Description |
|---------|-------------|
| `CAPTCHA` | `on` or `off`, in `.env`. Read by the backend and the frontend. |
| `CAPTCHA_THROTTLE_RATE` | Challenges and redeems per IP address, `30/minute` by default. |
| `DJANGO_STACK["CAPTCHA_CHALLENGES"]` | Puzzles in a challenge, 50 by default. |
| `DJANGO_STACK["CAPTCHA_DIFFICULTY"]` | Hex digits each puzzle's hash must start with, 4 by default. Each digit more makes the work 16 times longer. |

## Turn the captcha off or on

```bash
dstack config --captcha off
```

This sets `CAPTCHA=off` in `.env`: the API accepts public creates without a
token and the contact form hides the widget. Restart the project after it.
The throttle of `PUBLIC_WRITE_THROTTLE_RATE` still limits the messages per
IP address.

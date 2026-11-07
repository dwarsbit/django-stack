---
sidebar_position: 8.5
---

# 🔌 Headless

`init --frontend headless`, or `--preset api`, makes a project with the
content API and the admin only: no `frontend/` directory and no frontend
service. Use it when your own app, a mobile app or a frontend in another
repository reads the content.

```bash
npx @django-stack/cli init my-api --frontend headless
```

## What it has

- Django serves the whole domain: `/api/`, `/admin/`, `/static/`, the health
  checks, and a start page at `/` with links to the admin and the API schema.
- In development the backend answers on `SITE_PORT`, http://localhost:3000,
  like the site of the other frontends.
- In production Caddy sends every request to the backend, and serves
  uploads on the server's disk at `/media/`.
- The read-only key `API_READ_KEY` and the full-access key `API_SECRET_KEY`
  are in `.env`, as in every project. Give your frontend the read-only key
  and use it on a server only.
- The captcha stays on: a create in `PUBLIC_CREATE` without a key needs a
  token, which your frontend gets with the `Captcha` component or `loadCaptcha`
  of the `@django-stack` packages. See [Captcha](captcha.md).
- Page analytics is off: Umami's tracker runs in a frontend's pages.
  `init` refuses `--analytics umami` with `--frontend headless`.
- The package manager option does not apply.

## Your frontend

`dstack types`, or `npm run generate:types`, writes the OpenAPI schema to
`backend/openapi.json`. Generate your client's types from it, for example
with `npx headless generate --file openapi.json --out headless.ts`.

The admin's **Preview** button opens `/preview` on `SITE_URL`, which in a
headless project is the backend's own domain: it answers 404 there until a
frontend serves `/preview` on that domain. Set `REVALIDATE_URL` to the
endpoint where your frontend empties its page cache, with the same
`REVALIDATE_SECRET`; Django calls it when an editor saves. See
[Preview and revalidation](preview-revalidation.md).

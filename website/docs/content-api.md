---
sidebar_position: 3
---

# 📝 Content and the API

The content models are in `backend/content/models.py`. They are ordinary
Django models: Django Headless serves them as a REST API under `/api/`, and
Django Content Studio is their admin under `/admin/`.

## The starter content model

| Model | Purpose |
|-------|---------|
| `Page` | Pages in a tree. The `path` follows the parents, such as `about/team`. |
| `Post` | Blog posts with an author, categories and tags. |
| `Category`, `Tag`, `Author` | Taxonomies and authors of posts. |
| `Menu` | Menus of links to pages or URLs, such as `main` and `footer`. |
| `SiteSettings` | One object: the site name, logo, home page and defaults for SEO. |
| `Redirect` | Redirects from old paths, applied by the frontend. |
| `FormSubmission` | Messages from the contact form. |

Pages and posts have a `body` of blocks: text, image, quote and call to
action. Add a block in `backend/content/blocks.py` and a component for it in
`frontend/src/components/blocks/`.

Pages and posts are drafts until they are published. The API only returns
published content, except to a preview request.

## Access

The API is closed by default. Every request needs a key in the
`X-Secret-Key` header:

- `API_READ_KEY` reads published content. The frontend uses it, on the
  server only: the client in `@django-stack/utils` refuses to run in a
  browser with a key.
- `API_SECRET_KEY` has full access. Use it in scripts, never in the
  frontend.

A model in `DJANGO_STACK["PUBLIC_CREATE"]` accepts anonymous `POST`
requests, such as the contact form's `content.formsubmission`. These requests
are rate limited per IP address (`PUBLIC_WRITE_THROTTLE_RATE`, 10 per minute
by default), and nobody can read the model through the API without the
full-access key.

## Images

The `?expand=` parameter returns media objects with their URLs, sizes and
focal point. The frontend's `Image` component renders them with `srcset`. The
sizes are configured in `CONTENT_STUDIO["IMAGE_SIZES"]` and generated in the
background by the worker.

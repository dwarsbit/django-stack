---
sidebar_position: 5
---

# 👀 Preview and revalidation

## Preview

The **Preview** button on a page or a post in the admin opens it on the site
in preview mode, drafts included. The link carries a token signed with
`PREVIEW_SECRET` that expires after an hour (`DJANGO_STACK["PREVIEW_MAX_AGE"]`, in seconds).

The frontend checks the token at `/preview`, stores it in an HTTP-only
cookie, and sends it to the API in the `X-Preview-Token` header. The API then
returns drafts too. A banner on the site shows that preview mode is on, with a
link to `/preview/exit`.

## Revalidation

In production the frontend caches pages in memory (`CACHE_TTL`, 300 seconds
by default). When an editor saves content in the admin, the backend's worker
sends a signed `POST` to `REVALIDATE_URL`, and the frontend empties its cache
so the next request renders the new content.

The request has a JSON body and an `X-Django-Stack-Signature` header:

```text
X-Django-Stack-Signature: t=<unix time>,v1=<hex HMAC-SHA256 of "<t>.<body>">
```

The HMAC key is `REVALIDATE_SECRET`. `verifyWebhook()` in
`@django-stack/utils` checks it, and rejects requests older than five
minutes.

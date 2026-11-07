---
sidebar_position: 1
---

# 👋 Introduction

DjangoStack creates a ready-to-run website project: a Django backend, a
frontend, Postgres and Docker Compose, from one command. Every piece is an
open-source project you can read, change or remove.

- **Django Headless** serves your content models as a REST API.
- **Django Content Studio** is the admin where editors write and publish.
- **Astro** renders the site by default; Next.js, SvelteKit, Nuxt and
  Django's own templates are the alternatives.
- **Postgres** stores the content, and also the shared cache and the task
  queue, unless you pick **Valkey** for them.

DjangoStack is the glue between them. It is not a CMS of its own: the content
models live in your project, and features of the API or the admin belong in
Django Headless and Django Content Studio.

## Status

DjangoStack is in early development. Version 0.1 creates projects with the
Astro frontend and runs them with Docker Compose. Production deployment,
the Next.js frontend and the optional services follow in later releases.

Start with [Getting started](./getting-started.md).

## Packages

| Package | Registry | Purpose |
|---------|----------|---------|
| `@django-stack/cli` | npm | Creates and manages projects (`init`, `doctor`) |
| `@django-stack/utils` | npm | The API client, content helpers, SEO, images and webhook signatures |
| `@django-stack/react` | npm | React components for blocks, rich text and images |
| `@django-stack/next` | npm | Next.js route handlers, metadata and security headers |
| `@django-stack/svelte` | npm | Svelte components for blocks, rich text, images and SEO |
| `@django-stack/vue` | npm | Vue components for blocks, rich text and images |
| `django-stack` | PyPI | Settings from environment variables, API defaults, health checks and system checks |

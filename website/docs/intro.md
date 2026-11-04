---
sidebar_position: 1
---

# Introduction

DjangoStack creates a ready-to-run website project: a Django backend, a
frontend, Postgres and Docker Compose, from one command. Every piece is an
open-source project you can read, change or remove.

- **Django Headless** serves your content models as a REST API.
- **Django Content Studio** is the admin where editors write and publish.
- **Astro** renders the site by default; Next.js is the alternative.
- **Postgres** stores the content, and **Valkey** is the shared cache and
  task queue.

DjangoStack is the glue between them. It is not a CMS of its own: the content
models live in your project, and features of the API or the admin belong in
Django Headless and Django Content Studio.

## Status

DjangoStack is in early development. The packages are published as `0.0.x`
to reserve their names; the `init` command is not released yet.

## Packages

| Package | Registry | Purpose |
|---------|----------|---------|
| `@django-stack/cli` | npm | Creates and manages projects (`init`, `doctor`) |
| `@django-stack/utils` | npm | The API client, content helpers, SEO, images and webhook signatures |
| `@django-stack/react` | npm | React components for blocks, rich text, images and SEO |
| `@django-stack/next` | npm | Next.js route handlers and configuration |
| `django-stack` | PyPI | Settings from environment variables, API defaults, health checks and system checks |

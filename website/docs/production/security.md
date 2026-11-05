---
sidebar_position: 5
---

# 🛡️ Security

What a project does for you in production, and the checklist for what is
left to you.

## What is set up

**HTTPS.** Caddy gets and renews the certificate, redirects HTTP to HTTPS
and sends `Strict-Transport-Security` for a year. Django marks the session
and CSRF cookies `Secure` for an `https` `SITE_URL`.

**Headers.** Every response has `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` and
`X-Frame-Options: DENY`, and no `Server` header. The frontend's pages have a
Content Security Policy with hashes for its own scripts and styles: no
inline script runs unless Astro built it. Images and video may come only
from the site and from `S3_PUBLIC_URL`. Uploaded files in `/media` are
served with `script-src 'none'`, so an uploaded HTML or SVG file cannot run
scripts on your domain.

**Containers.** The backend, worker and frontend containers run as
a user without privileges. They, Caddy and Valkey run on a read-only file
system with only `/tmp` and their volumes writable, without Linux
capabilities (Caddy keeps only the one to bind ports 80 and 443) and with
`no-new-privileges`. Each has a memory limit. Only
Caddy has public ports; development ports listen on `127.0.0.1` only.

**Secrets.** The frontend never receives the full-access API key or the
database password: it reads content with the read-only key. `init` and
`production` generate every secret, and `production` never reuses one from
development.

**Checks.** The backend runs `python manage.py check --deploy` before it
starts and stops on an error, such as debug on for an `https` site or the
two API keys being the same. Warnings appear in its log. DjangoStack's own
checks are in [Configuration](../configuration.md#system-checks).

**Throttling.** The public form routes are limited to 10 requests a
minute per client (`PUBLIC_WRITE_THROTTLE_RATE`). `NUM_PROXIES` makes the
limit apply to the client, not to the proxy.

## Checklist

Before the site goes live:

- [ ] `.env` on the server came from `dstack production`, and is not
      in git. `chmod 600 .env`.
- [ ] `dstack check` shows no issues. In production it runs Django's
      deploy checks.
- [ ] The admin password is changed from the generated one, or kept in a
      password manager, and `ADMIN_EMAIL` is a real address for password
      resets.
- [ ] `EMAIL_URL` is your SMTP server; a password reset mail arrives.
- [ ] The server's firewall allows only SSH, 80 and 443. Docker's published
      ports bypass `ufw`; only Caddy publishes any.
- [ ] SSH accepts keys only, and the server installs security updates
      (`unattended-upgrades` on Debian and Ubuntu).
- [ ] A media bucket, if any, allows public reads but not public listing or
      writes. A backup bucket is not public at all.
- [ ] `BACKUP_S3_BUCKET` is set, or the server's disk is backed up, and you
      have restored a backup once. See [Backups](./backups.md).
- [ ] `SEED_DEMO_CONTENT=0` if the demo content should not appear.

Over time:

- [ ] Update the images: `git pull` brings new versions of the project's
      dependencies when you upgrade them, and `dstack update` gets new
      Postgres, Valkey and Caddy images of the same major version.
- [ ] Rotate a secret that may have leaked: `dstack secret`
      prints a new one. Change it in `.env` and run `dstack run`.
- [ ] Check the advisories of Django and the frontend's dependencies:
      `uv lock --upgrade` in `backend/` and `npm update` in `frontend/`, then deploy.

## HSTS for subdomains

`SECURE_HSTS_INCLUDE_SUBDOMAINS=1` and `SECURE_HSTS_PRELOAD=1` extend HSTS
to every subdomain and to the browsers' preload list. Turn them on only when
every subdomain of the domain serves HTTPS: a preload is hard to undo.

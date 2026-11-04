---
"@django-stack/cli": minor
---

Production: the `production` command writes `.env.production` for a server, `doctor` checks the prod profile, and `init --local-s3` adds a local S3 service. New projects run in production behind Caddy with HTTPS, hardened containers, daily database backups and an optional GitHub Actions deploy workflow.

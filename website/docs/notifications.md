---
sidebar_position: 7
---

# 🔔 Notifications

Editors get notifications in the admin when content they created or follow
changes, and when a visitor sends a message with the contact form. What they
leave unread for an hour arrives in one email. Each editor picks which
notifications they get, and whether they get the email, on their settings
page in the admin.

The notifications come from
[Django Content Studio](https://djangocontentstudio.org); DjangoStack only
turns them on and runs them. `init` turns them on unless you pass
`--notifications off`.

## What `init` sets up

- **The app**: `content_studio.notifications` in `INSTALLED_APPS` in
  `backend/config/settings.py`. Its tables are in the project's database.
- **The contact form event** in `backend/content/notifications.py`: every
  editor who may read the form submissions hears about a new one. Register
  your own events in that file and send them with `notify()`.
- **Two tasks of the worker**: the email digest every hour, and removing
  read notifications older than 90 days every night
  (`NOTIFICATION_RETENTION` in `CONTENT_STUDIO`).

## Mail

In development the emails go to Mailpit, at http://localhost:8025. In
production they go to the SMTP server in `EMAIL_URL`; `dstack settings`
asks for it. The links in the emails point at `BACKEND_URL`.

With `--tasks off` there is no worker, so editors see the notifications in
the admin but get no email digest.

## Turn notifications off or on

```bash
dstack config --notifications off
```

This takes `content_studio.notifications` out of `INSTALLED_APPS`, so
nothing is notified or mailed; the tables and their notifications stay, and
come back with `--notifications on`. Restart the project after either. The
contact form event only registers while the app is installed.

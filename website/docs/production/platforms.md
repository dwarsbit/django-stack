---
sidebar_position: 2
---

# 🧩 Coolify and Dokploy

[Coolify](https://coolify.io/) and [Dokploy](https://dokploy.com/) deploy a
Docker Compose project from its git repository and put their own proxy in
front of it, which gets the certificate. The project's Caddy then serves
plain HTTP to that proxy and keeps routing `/admin`, `/api`, `/static` and
`/media` on one domain.

:::note
These setups follow the platforms' documentation; the continuous
integration of DjangoStack tests the [server setup](./server.md), not the
platforms themselves.
:::

## Settings for both

Create the settings with the CLI, as for a server:

```bash
npx @django-stack/cli production --domain example.com \
  --email-url smtp+tls://user:password@smtp.example.com:587
```

Put every line of `.env.production` into the platform's environment
variables, and add these, so Caddy answers on port 80 without HTTPS and
trusts the platform's proxy:

```bash
CADDY_ADDRESS=:80
TRUSTED_PROXIES=private_ranges
NUM_PROXIES=2
# Keep Caddy off the ports of the platform's proxy.
HTTP_PORT=127.0.0.1:8080
HTTPS_PORT=127.0.0.1:8443
```

`NUM_PROXIES=2` tells Django that two proxies forward each request (the
platform's and Caddy), so it sees the client's address and the `https`
scheme.

## Dokploy

1. Create a project, then a **Compose** service with your repository as the
   source and `compose.yaml` as the compose path.
2. Under **Environment**, paste the variables from above. Dokploy writes them
   to the `.env` next to `compose.yaml`, so `COMPOSE_PROFILES` picks the
   services.
3. Under **Domains**, add `example.com` for the service `proxy`, port `80`,
   with HTTPS on.
4. Deploy. The logs show the build, then the backend's migrations.

Dokploy adds its network to the `proxy` service when you add the domain.

## Coolify

The CLI sets up the project in Coolify and deploys it, with a Coolify API
key. Push the project to a git repository first: Coolify builds it on its
server from there.

1. In Coolify, create an API key under **Keys & Tokens** with the `read`,
   `write` and `deploy` permissions, and turn the API on under
   **Settings** › **Advanced**.
2. Write the settings for the domain:

   ```bash
   dstack production --domain example.com \
     --email-url smtp+tls://user:password@smtp.example.com:587
   ```

3. Set up the project in Coolify. It asks for the API key, creates the
   project and the application, gives the `proxy` service the domain and
   uploads `.env.production` with the variables above:

   ```bash
   dstack deploy setup --url https://coolify.example.com
   ```

4. Point the domain's DNS at the Coolify server, then deploy:

   ```bash
   dstack deploy
   ```

`dstack deploy status` shows whether the site runs and the last deploys.
For a private repository, connect a GitHub App in Coolify first and pick it
during setup. See the [CLI reference](../cli.md#deploy) for every option.

To set up the resource by hand instead:

1. Add a resource from your repository with the **Docker Compose** build
   pack and `/compose.yaml` as the file.
2. Under **Environment Variables**, add the variables from above.
3. Under **Domains**, give the `proxy` service `https://example.com:80`:
   the port tells Coolify's proxy where Caddy listens.
4. Deploy.

If a service you expect does not start, check that `COMPOSE_PROFILES` is
set: without it, Compose starts only the cache.

## Updates and backups

Each deploy from the platform rebuilds the images and restarts the services;
the backend migrates the database before it starts. The daily backup
in `worker-prod` works as on a server: see [Backups](./backups.md). The platforms' own
database backups do not cover the bundled database, which lives in the
project's volume.

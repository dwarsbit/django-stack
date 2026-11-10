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
dstack production --domain example.com \
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

The CLI sets up the project in Dokploy and deploys it, with a Dokploy API
key. Push the project to a public git repository first: Dokploy builds it
on its server from there.

1. In Dokploy, create an API key under **Settings** › **Profile** ›
   **API/CLI**.
2. Write the settings for the domain:

   ```bash
   dstack production --domain example.com \
     --email-url smtp+tls://user:password@smtp.example.com:587
   ```

3. Set up the project in Dokploy. It asks for the API key, creates the
   project, the environment and the compose service from your repository,
   gives the `proxy` service the domain with a Let's Encrypt certificate and
   uploads `.env.production` with the variables above:

   ```bash
   dstack deploy setup --provider dokploy --url https://dokploy.example.com
   ```

4. Point the domain's DNS at the Dokploy server, then deploy:

   ```bash
   dstack deploy
   ```

`dstack deploy status` shows the state of the service and the last deploys.
Dokploy shows the build log in its dashboard only, so `dstack deploy logs`
links to it. `--force` has no effect: Dokploy has no rebuild without cache
in its API. For a private repository, set up the compose service by hand as
below, with a git provider connected in Dokploy.

To set up the service by hand instead:

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
   project and the application, gives the `proxy` service the domain,
   turns on **Preserve repository during deployment** so Caddy finds
   `caddy/Caddyfile`, and uploads `.env.production` with the variables above:

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
4. Turn on **Preserve repository during deployment** (under **General** ›
   **Build pipeline** or **Advanced**). Coolify starts the services from its
   own directory on the server, and without the repository there the
   `proxy` service cannot mount `./caddy`.
5. Deploy.

If Caddy does not start because `/etc/caddy/Caddyfile` is missing, the
setting of step 4 is off: turn it on and deploy again.

A project created by DjangoStack 0.12.9 or older mounts `./Caddyfile`
itself, and Coolify creates that path as a directory before it copies the
repository, so the deploy fails with "cannot overwrite directory
"Caddyfile"". Move the file to `caddy/Caddyfile`, mount
`./caddy:/etc/caddy:ro` in the `proxy` service of `compose.yaml`, push,
and delete the directory on the server:
`rm -rf /data/coolify/applications/<uuid>/Caddyfile`.

If a service you expect does not start, check that `COMPOSE_PROFILES` is
set: without it, Compose starts only the cache.

## Updates and backups

Each deploy from the platform rebuilds the images and restarts the services;
the backend migrates the database before it starts. The daily backup
in `worker-prod` works as on a server: see [Backups](./backups.md). The platforms' own
database backups do not cover the bundled database, which lives in the
project's volume.

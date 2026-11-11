import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseEnv } from "../src";
import {
  addDefaultNetwork,
  migrateDefaultNetwork,
  migrateErrorPages,
  migrateProxyPorts,
  PORTS_COMPOSE,
} from "../src/migrate";

const root = mkdtempSync(join(tmpdir(), "django-stack-migrate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const OLD_PROXY = `services:
  # The only service with public ports: HTTPS for SITE_URL with a
  # certificate from Let's Encrypt, routing to Django and the frontend.
  # Behind a platform's proxy, see CADDY_ADDRESS in .env.
  proxy:
    profiles: [prod]
    networks: [default]
    ports:
      - "\${HTTP_PORT:-80}:80"
      - "\${HTTPS_PORT:-443}:443"
      - "\${HTTPS_PORT:-443}:443/udp"
    restart: unless-stopped
`;

function project(files: Record<string, string>): string {
  const directory = mkdtempSync(join(root, "p"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
  return directory;
}

describe("migrateProxyPorts", () => {
  it("moves the proxy's ports to compose.ports.yaml", () => {
    const directory = project({
      "compose.yaml": OLD_PROXY,
      ".env": "COMPOSE_PROFILES=dev,db\n",
      ".env.run": "COMPOSE_PROFILES=prod,db\nSITE_URL=https://site.localhost\n",
      ".env.production": "COMPOSE_PROFILES=prod,db\nCADDY_ADDRESS=:80\n",
    });
    const result = migrateProxyPorts(directory);
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).not.toContain("ports:");
    expect(compose).not.toContain("The only service with public ports");
    expect(compose).toContain("    networks: [default]\n    restart: unless-stopped\n");
    expect(readFileSync(join(directory, "compose.ports.yaml"), "utf8")).toBe(PORTS_COMPOSE);
    // The local run publishes its ports; development and a platform's settings don't.
    const env = (name: string) => parseEnv(readFileSync(join(directory, name), "utf8"));
    expect(env(".env.run").COMPOSE_FILE).toBe("compose.yaml:compose.ports.yaml");
    expect(env(".env").COMPOSE_FILE).toBeUndefined();
    expect(env(".env.production").COMPOSE_FILE).toBeUndefined();
    expect(result.changed).toHaveLength(2);
    expect(result.todo.join("\n")).toContain("HTTP_PORT and HTTPS_PORT");

    expect(migrateProxyPorts(directory)).toEqual({ changed: [], todo: [] });
  });

  it("leaves ports it does not recognize and says so", () => {
    const changed = OLD_PROXY.replace(":-80}:80", ":-8000}:80");
    const directory = project({ "compose.yaml": changed, ".env": "COMPOSE_PROFILES=prod,db\n" });
    const result = migrateProxyPorts(directory);
    expect(readFileSync(join(directory, "compose.yaml"), "utf8")).toBe(changed);
    expect(existsSync(join(directory, "compose.ports.yaml"))).toBe(false);
    expect(result.todo).toHaveLength(1);
  });
});

const OLD_SERVICES = `x-depends: &depends
  db:
    condition: service_healthy

services:
  worker-prod:
    profiles: [prod]
    healthcheck: *worker-health
    deploy:
      replicas: \${TASK_WORKERS:-1}
    restart: unless-stopped

  # HTTPS for SITE_URL.
  proxy:
    profiles: [prod]
    volumes:
      - ./caddy:/etc/caddy:ro
    depends_on:
      backend-prod:
        condition: service_healthy
    logging: *logging
    restart: unless-stopped

  db:
    profiles: [db]
    image: postgres:17-alpine

volumes:
  pgdata:
`;

describe("migrateDefaultNetwork", () => {
  it("puts the production services on the default network", () => {
    const directory = project({ "compose.yaml": OLD_SERVICES });
    const result = migrateDefaultNetwork(directory);
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).toContain("      replicas: ${TASK_WORKERS:-1}\n    restart: unless-stopped\n\n  # HTTPS");
    expect(compose).toContain("    healthcheck: *worker-health\n    # Explicit,");
    expect(compose).toContain("aliases live.\n    networks: [default]\n    deploy:\n");
    expect(compose).toContain("aliases live.\n    networks: [default]\n    logging: *logging\n");
    expect(compose).toContain("    image: postgres:17-alpine\n    # Explicit,");
    expect(compose).toContain("    networks: [default]\n\nvolumes:\n");
    expect(compose.match(/networks: \[default\]/g)).toHaveLength(3);
    expect(result.changed).toEqual(["Put proxy, worker-prod, db on the default network in compose.yaml."]);

    expect(migrateDefaultNetwork(directory)).toEqual({ changed: [], todo: [] });
  });

  it("leaves services that list networks", () => {
    const compose = "services:\n  proxy:\n    networks:\n      - web\n    restart: always\n";
    expect(addDefaultNetwork(compose, "proxy")).toBe(compose);
    expect(addDefaultNetwork(compose, "worker-prod")).toBe(compose);
  });

  it("finds nothing to change in the template", () => {
    const template = readFileSync(join(__dirname, "../../../templates/base/compose.yaml"), "utf8");
    const directory = project({ "compose.yaml": template });
    expect(migrateDefaultNetwork(directory).changed).toEqual([]);
  });
});

describe("migrateErrorPages", () => {
  const templates = fileURLToPath(new URL("../templates", import.meta.url));

  function frontend(files: string[]): string {
    const directory = mkdtempSync(join(root, "p"));
    for (const name of files) {
      mkdirSync(dirname(join(directory, "frontend", name)), { recursive: true });
      writeFileSync(join(directory, "frontend", name), "");
    }
    return directory;
  }

  it("adds the Astro 500 page", () => {
    const directory = frontend(["astro.config.mjs", "src/pages/index.astro"]);
    expect(migrateErrorPages(directory, templates).changed).toEqual([
      "Added frontend/src/pages/500.astro, an error page that renders without the API.",
    ]);
    expect(readFileSync(join(directory, "frontend/src/pages/500.astro"), "utf8")).toBe(
      readFileSync(join(templates, "frontend-astro/src/pages/500.astro"), "utf8"),
    );
  });

  it("adds the Next.js global error page", () => {
    const directory = frontend(["next.config.ts", "src/app/page.tsx"]);
    migrateErrorPages(directory, templates);
    expect(existsSync(join(directory, "frontend/src/app/global-error.tsx"))).toBe(true);
  });

  it("keeps a page the project has", () => {
    const directory = frontend(["astro.config.mjs", "src/pages/500.astro"]);
    expect(migrateErrorPages(directory, templates).changed).toEqual([]);
    expect(readFileSync(join(directory, "frontend/src/pages/500.astro"), "utf8")).toBe("");
    const next = frontend(["next.config.ts", "src/app/global-error.js"]);
    expect(migrateErrorPages(next, templates).changed).toEqual([]);
  });

  it("leaves other frontends alone", () => {
    expect(migrateErrorPages(frontend(["nuxt.config.ts", "src/app.vue"]), templates).changed).toEqual([]);
    expect(migrateErrorPages(mkdtempSync(join(root, "p")), templates).changed).toEqual([]);
  });
});

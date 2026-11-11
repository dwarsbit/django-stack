import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv, writePrivateFile } from "./env";
import { PORTS_COMPOSE_FILE, SERVER_COMPOSE_FILE, setComposeFile } from "./production";
import { RUN_ENV } from "./project";
import { defaultTemplatesDir } from "./scaffold";

/** compose.ports.yaml as `init` writes it. */
export const PORTS_COMPOSE = `# The host ports of Caddy, for a server without a platform's proxy. Load it
# with COMPOSE_FILE=compose.yaml:compose.ports.yaml in .env. Coolify and
# Dokploy reach the proxy over the Docker network instead, so several
# projects can share one server.
services:
  proxy:
    ports:
      - "\${HTTP_PORT:-80}:80"
      - "\${HTTPS_PORT:-443}:443"
      - "\${HTTPS_PORT:-443}:443/udp"
`;

const PROXY_PORTS =
  /^ {4}ports:\n {6}- "\$\{HTTP_PORT:-80\}:80"\n {6}- "\$\{HTTPS_PORT:-443\}:443"\n {6}- "\$\{HTTPS_PORT:-443\}:443\/udp"\n/m;

const OLD_COMMENT = `  # The only service with public ports: HTTPS for SITE_URL with a
  # certificate from Let's Encrypt, routing to Django and the frontend.
  # Behind a platform's proxy, see CADDY_ADDRESS in .env.
`;

const NEW_COMMENT = `  # HTTPS for SITE_URL with a certificate from Let's Encrypt, routing to
  # Django and the frontend. It publishes no ports here: on a server of your
  # own, compose.ports.yaml publishes 80 and 443 (COMPOSE_FILE in .env);
  # behind a platform's proxy, the platform reaches it on port 80 over the
  # Docker network (see CADDY_ADDRESS in .env).
`;

export interface Migration {
  /** What changed, one line each. */
  changed: string[];
  /** What to change by hand, one line each. */
  todo: string[];
}

/**
 * Moves the proxy's host ports out of compose.yaml into compose.ports.yaml,
 * so several projects on one Coolify or Dokploy server don't ask for the
 * same ports. The .env files of this machine that run Caddy on its own ports
 * get COMPOSE_FILE; the server's and the platform's are changed by hand.
 */
export function migrateProxyPorts(directory: string): Migration {
  const result: Migration = { changed: [], todo: [] };
  const composePath = join(directory, "compose.yaml");
  const portsPath = join(directory, PORTS_COMPOSE_FILE);
  if (existsSync(portsPath) || !existsSync(composePath)) return result;
  const compose = readFileSync(composePath, "utf8");
  if (!PROXY_PORTS.test(compose)) {
    if (compose.includes("${HTTP_PORT"))
      result.todo.push(
        `compose.yaml publishes the proxy's ports in a way dstack does not recognize. Move them to ${PORTS_COMPOSE_FILE} as the changelog describes.`,
      );
    return result;
  }
  writeFileSync(composePath, compose.replace(PROXY_PORTS, "").replace(OLD_COMMENT, NEW_COMMENT));
  writeFileSync(portsPath, PORTS_COMPOSE);
  result.changed.push(`Moved the proxy's ports from compose.yaml to ${PORTS_COMPOSE_FILE}.`);

  for (const name of [".env", RUN_ENV, ".env.production"]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const env = parseEnv(text);
    const prod = (env.COMPOSE_PROFILES ?? "").split(",").some((profile) => profile.trim() === "prod");
    // CADDY_ADDRESS=:80 is Caddy behind a platform's proxy, which needs no host ports.
    if (!prod || env.COMPOSE_FILE || (env.CADDY_ADDRESS ?? "").startsWith(":")) continue;
    writePrivateFile(path, setComposeFile(text, SERVER_COMPOSE_FILE));
    result.changed.push(`Added COMPOSE_FILE=${SERVER_COMPOSE_FILE} to ${name}.`);
  }
  result.todo.push(
    `On a server of your own, copy ${PORTS_COMPOSE_FILE} there and add COMPOSE_FILE=${SERVER_COMPOSE_FILE} to its .env, or Caddy publishes no ports.`,
    "On Coolify or Dokploy, remove HTTP_PORT and HTTPS_PORT from the app's environment variables.",
  );
  return result;
}

/** The production services that reach others by name, and the ones they reach. */
const DEFAULT_NETWORK_SERVICES = ["proxy", "worker-prod", "umami", "db", "cache"];

const DEFAULT_NETWORK = `    # Explicit, so Coolify and Dokploy keep this service on the network where
    # the backend and frontend aliases live.
    networks: [default]
`;

/**
 * Adds `networks: [default]` to a service of compose.yaml without a networks
 * key. Returns the text unchanged when the service is missing or has one.
 */
export function addDefaultNetwork(compose: string, service: string): string {
  const lines = compose.split("\n");
  // After `services:`: x-backend-depends names services at the same indent.
  const start = lines.indexOf(`  ${service}:`, lines.indexOf("services:") + 1);
  if (start < 0) return compose;
  // The service ends at the next line that is not indented by four spaces:
  // the next service, its comment, or a top-level key.
  let end = start + 1;
  const inside = (line: string | undefined) => line !== undefined && (line.startsWith("    ") || line === "");
  while (inside(lines[end])) end++;
  while (end > start + 1 && lines[end - 1] === "") end--;
  const body = lines.slice(start + 1, end);
  if (body.some((line) => /^ {4}networks:/.test(line))) return compose;
  const before = body.findIndex((line) => /^ {4}(deploy|logging|restart):/.test(line));
  const at = before < 0 ? end : start + 1 + before;
  lines.splice(at, 0, ...DEFAULT_NETWORK.trimEnd().split("\n"));
  return lines.join("\n");
}

/**
 * Puts the production services of compose.yaml on the default network
 * explicitly. Coolify and Dokploy attach every service to a network of
 * their own; one without a networks key then loses `default`, so Caddy
 * and the worker could not resolve `frontend` or `backend`.
 */
export function migrateDefaultNetwork(directory: string): Migration {
  const result: Migration = { changed: [], todo: [] };
  const path = join(directory, "compose.yaml");
  if (!existsSync(path)) return result;
  const compose = readFileSync(path, "utf8");
  let next = compose;
  const added: string[] = [];
  for (const service of DEFAULT_NETWORK_SERVICES) {
    const changed = addDefaultNetwork(next, service);
    if (changed !== next) added.push(service);
    next = changed;
  }
  if (!added.length) return result;
  writeFileSync(path, next);
  result.changed.push(`Put ${added.join(", ")} on the default network in compose.yaml.`);
  return result;
}

/** The error pages that call no API, by frontend: the file that marks the frontend, then the page. */
const ERROR_PAGES = [
  { marker: "astro.config.mjs", page: "src/pages/500.astro", template: "frontend-astro", others: [] },
  {
    marker: "next.config.ts",
    page: "src/app/global-error.tsx",
    template: "frontend-next",
    others: ["src/app/global-error.jsx", "src/app/global-error.js"],
  },
];

/**
 * Adds the error page of the frontend that renders without the API, so a
 * failing backend or database shows a page instead of an empty 500 (which
 * some browsers offer as a download). A page the project has is kept.
 */
export function migrateErrorPages(directory: string, templatesDir = defaultTemplatesDir()): Migration {
  const result: Migration = { changed: [], todo: [] };
  const frontend = join(directory, "frontend");
  for (const { marker, page, template, others } of ERROR_PAGES) {
    if (!existsSync(join(frontend, marker))) continue;
    if (!existsSync(join(frontend, dirname(page)))) continue;
    if ([page, ...others].some((name) => existsSync(join(frontend, name)))) continue;
    copyFileSync(join(templatesDir, template, page), join(frontend, page));
    result.changed.push(`Added frontend/${page}, an error page that renders without the API.`);
  }
  return result;
}

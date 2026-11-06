/**
 * Turns the resolved Compose project (`docker compose config --format json`)
 * into Railway services. Railway runs each service on its own and reaches it
 * at `<name>.railway.internal` on the private network; a service has at most
 * one volume and no bind mounts, and Railway builds a service from a
 * directory of the git repository. This module is pure, so it is tested on
 * the template's output.
 */

import { posix, relative, sep } from "node:path";
import type { ComposeProject, ComposeService } from "./bunny-compose";

export interface RailwayServicePlan {
  /** The Compose service. */
  service: string;
  /** The service's name on Railway and its private host name, such as backend for backend-prod. */
  name: string;
  /** Railway builds the directory of the repository, or pulls a public image. */
  source: { kind: "repo"; rootDirectory: string; dockerfile?: string } | { kind: "image"; image: string };
  /** The variables of the service. */
  env: Record<string, string>;
  /** Railway's start command, or undefined for the image's own. */
  startCommand?: string;
  /** The port the service listens on, given as PORT; Railway sends health checks and the domain there. */
  port?: number;
  healthcheckPath?: string;
  replicas: number;
  /** The mount path of the service's volume. */
  volume?: string;
  /** Paths whose changes trigger a deploy of the service, for services built from the repository. */
  watchPatterns?: string[];
  /** The service with the site's domain. */
  public: boolean;
}

export interface RailwayPlan {
  name: string;
  services: RailwayServicePlan[];
  /** Compose settings Railway has no equivalent for; printed once. */
  ignored: string[];
}

export interface RailwayPlanOptions {
  /** The project directory, which build contexts are relative to. */
  directory: string;
  /** Reads a file of the project; throws when it is not a readable file. */
  readFile(path: string): string;
}

/** Volumes not needed on Railway: its edge holds the certificate, uploads and backups go to S3. */
export const RAILWAY_DROPPED_VOLUMES = new Set(["caddy_data", "caddy_config", "backups", "media"]);

/** Compose keys that do not apply on Railway. */
const IGNORED_KEYS = [
  "read_only",
  "tmpfs",
  "cap_add",
  "cap_drop",
  "security_opt",
  "user",
  "restart",
  "depends_on",
];

/** Railway's Postgres image, which its own Postgres template runs. */
export const RAILWAY_POSTGRES_IMAGE = "ghcr.io/railwayapp-templates/postgres-ssl";

/**
 * The default command of images whose bind-mounted file the CLI writes before
 * it starts them; Railway's start command replaces the image's command.
 */
const IMAGE_COMMANDS: { pattern: RegExp; command: string[] }[] = [
  {
    pattern: /^(docker\.io\/)?(library\/)?caddy(:|@|$)/,
    command: ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `name:port` where name is a whole host name, such as backend:8000 in http://backend:8000/api. */
function hostPattern(name: string): RegExp {
  return new RegExp(`(^|[^\\w.-])${escapeRegExp(name)}:(\\d{1,5})(?!\\d)`, "g");
}

/** Replaces Compose host names with the private host names of the Railway services. */
export function railwayHosts(text: string, hosts: Record<string, string>): string {
  let result = text;
  for (const [name, service] of Object.entries(hosts))
    result = result.replace(
      hostPattern(name),
      (_whole, before: string, port: string) => `${before}${service}.railway.internal:${port}`,
    );
  return result;
}

/** A Railway service name: lower case letters, digits and dashes. */
export function railwayName(service: string): string {
  const name = service
    .replace(/-prod$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name.slice(0, 32) || "service";
}

/** Quotes a word of a start command only when it needs it. */
export function commandWord(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The variable that holds a bind-mounted file, such as DSTACK_FILE_CADDYFILE. */
export function fileVariable(target: string): string {
  const base = posix.basename(target) || "file";
  return `DSTACK_FILE_${base.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/** The last stage of a Dockerfile, which Railway builds. */
export function lastStage(dockerfile: string): string | undefined {
  let stage: string | undefined;
  for (const match of dockerfile.matchAll(/^\s*FROM\s+(?:--\S+\s+)*\S+(?:\s+AS\s+(\S+))?\s*$/gim))
    stage = match[1]?.toLowerCase() ?? "";
  return stage;
}

function healthPath(definition: ComposeService): { port: number; path: string } | undefined {
  if (definition.healthcheck?.disable) return undefined;
  const text = (definition.healthcheck?.test ?? []).join(" ");
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(\/[^\s'"]*)?/);
  if (!match) return undefined;
  return { port: Number(match[1] ?? 80), path: match[2] ?? "/" };
}

/** The names other services reach a service by: its name and its network aliases. */
function hostNames(service: string, definition: ComposeService): string[] {
  const names = new Set([service]);
  for (const network of Object.values(definition.networks ?? {}))
    for (const alias of network?.aliases ?? []) names.add(alias);
  return [...names];
}

/** Plans the Railway services for a resolved Compose project. */
export function planRailway(project: ComposeProject, options: RailwayPlanOptions): RailwayPlan {
  // A service scaled to 0, such as the worker with TASK_WORKERS=0, does not run.
  const entries = Object.entries(project.services)
    .filter(([, definition]) => (definition.deploy as { replicas?: number } | undefined)?.replicas !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) throw new Error("compose.yaml has no services for production.");

  // Railway names, and which Compose names reach which Railway service.
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const [service] of entries) {
    let name = railwayName(service);
    for (let index = 2; taken.has(name); index++) name = `${railwayName(service).slice(0, 29)}-${index}`;
    taken.add(name);
    names.set(service, name);
  }
  const hosts: Record<string, string> = {};
  for (const [service, definition] of entries)
    for (const host of hostNames(service, definition)) hosts[host] = names.get(service) as string;

  // The port each service listens on, from where other services reach it.
  const texts: string[] = [];
  for (const [, definition] of entries)
    for (const value of Object.values(definition.environment ?? {})) if (value) texts.push(value);
  const files = new Map<string, { target: string; content: string }[]>();
  for (const [service, definition] of entries) {
    const binds = (definition.volumes ?? []).filter((mount) => mount.type === "bind");
    if (!binds.length) continue;
    files.set(
      service,
      binds.map((mount) => {
        let content: string;
        try {
          content = options.readFile(mount.source ?? "");
        } catch {
          throw new Error(
            `${service} bind-mounts ${mount.source}, which is not a file; Railway has no bind mounts, so only files can be passed to the service.`,
          );
        }
        texts.push(content);
        return { target: mount.target, content };
      }),
    );
  }

  const published = entries.filter(([, definition]) => (definition.ports ?? []).length);
  if (published.length !== 1)
    throw new Error(
      published.length
        ? `${published.map(([service]) => service).join(" and ")} publish ports; Railway gives the site one domain, so only the proxy may.`
        : "No service publishes a port, so there is nothing for Railway's domain to send requests to.",
    );
  const publicService = published[0]?.[0] as string;

  const s3 = entries.some(([, definition]) => Boolean(definition.environment?.S3_BUCKET));
  const ignored = new Set<string>();
  const services: RailwayServicePlan[] = [];
  for (const [service, definition] of entries) {
    const name = names.get(service) as string;
    for (const key of IGNORED_KEYS)
      if (definition[key] !== undefined && definition[key] !== null) ignored.add(key);
    if ((definition.deploy as { resources?: unknown } | undefined)?.resources)
      ignored.add("deploy.resources");

    // The port: the one other services use, the health check's, or the published one.
    const found = new Set<number>();
    for (const host of hostNames(service, definition))
      for (const text of texts)
        for (const match of text.matchAll(hostPattern(host))) found.add(Number(match[2]));
    const health = healthPath(definition);
    if (health) found.add(health.port);
    const ports = (definition.ports ?? []).map((port) => port.target);
    let port: number | undefined;
    if (service === publicService) port = ports.includes(80) ? 80 : ports[0];
    else if (found.size > 1)
      throw new Error(
        `${service} is reached on ports ${[...found].join(" and ")}; Railway routes one port per service.`,
      );
    else port = [...found][0];

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(definition.environment ?? {})) {
      if (value === null || value === undefined || key === "COMPOSE_PROFILES" || key === "ENV_FILE") continue;
      env[key] = railwayHosts(value, hosts);
    }
    if (port !== undefined && !env.PORT) env.PORT = String(port);

    let source: RailwayServicePlan["source"];
    let watchPatterns: string[] | undefined;
    if (definition.build) {
      const context = relative(options.directory, definition.build.context).split(sep).join("/");
      if (context.startsWith(".."))
        throw new Error(`${service} builds ${definition.build.context}, outside the project.`);
      const dockerfile = definition.build.dockerfile ?? "Dockerfile";
      const target = definition.build.target;
      if (target) {
        let text: string | undefined;
        try {
          text = options.readFile(posix.join(definition.build.context, dockerfile));
        } catch {}
        const last = text === undefined ? undefined : lastStage(text);
        if (last !== undefined && last !== target.toLowerCase())
          throw new Error(
            `${service} builds the ${target} stage of ${context || "."}/${dockerfile}, and Railway builds the last stage only. Make ${target} the last stage.`,
          );
      }
      for (const [key, value] of Object.entries(definition.build.args ?? {}))
        if (env[key] === undefined && value != null) env[key] = String(value);
      const rootDirectory = `/${context}`.replace(/\/$/, "") || "/";
      source = {
        kind: "repo",
        rootDirectory,
        ...(dockerfile !== "Dockerfile" ? { dockerfile } : {}),
      };
      watchPatterns = [rootDirectory === "/" ? "/**" : `${rootDirectory}/**`];
    } else if (definition.image) {
      let image = definition.image;
      const postgres = image.match(/^(?:docker\.io\/)?(?:library\/)?postgres:(\d+)(?:[.-][\w.-]*)?$/);
      if (postgres) image = `${RAILWAY_POSTGRES_IMAGE}:${postgres[1]}`;
      source = { kind: "image", image };
    } else {
      throw new Error(`${service} has neither an image nor a build.`);
    }

    // Bind-mounted files go into variables; the start command writes them first.
    let startCommand: string[] | undefined =
      definition.entrypoint?.length || definition.command?.length
        ? [...(definition.entrypoint ?? []), ...(definition.command ?? [])]
        : undefined;
    const bound = files.get(service);
    if (bound) {
      if (definition.build)
        throw new Error(
          `${service} bind-mounts a file; Railway has no bind mounts. Copy the file into the image in its Dockerfile.`,
        );
      const command =
        startCommand ?? IMAGE_COMMANDS.find((item) => item.pattern.test(definition.image ?? ""))?.command;
      if (!command)
        throw new Error(
          `${service} bind-mounts ${bound[0]?.target}; Railway has no bind mounts. Give the service a command in compose.yaml, or build an image with the file.`,
        );
      const writes = bound.map((file) => {
        const variable = fileVariable(file.target);
        env[variable] = railwayHosts(file.content, hosts);
        return `printf %s "$${variable}" > ${commandWord(file.target)}`;
      });
      startCommand = [
        "/bin/sh",
        "-c",
        [...writes, `exec ${command.map(commandWord).join(" ")}`].join(" && "),
      ];
    }

    let volume: string | undefined;
    for (const mount of definition.volumes ?? []) {
      if (mount.type === "tmpfs" || mount.type === "bind") continue;
      if (mount.type !== "volume" || !mount.source)
        throw new Error(`${service} mounts a ${mount.type} volume, which Railway does not have.`);
      if (mount.source === "media" && !s3)
        throw new Error(
          "Uploads must be in S3 on Railway: a Railway volume belongs to one service, and the backend, the worker and Caddy all need the uploads. Set S3_BUCKET and the other S3_ variables in .env.production (see the docs on media).",
        );
      if (RAILWAY_DROPPED_VOLUMES.has(mount.source)) continue;
      if (volume)
        throw new Error(
          `${service} mounts two volumes, ${volume} and ${mount.target}; Railway gives a service one volume.`,
        );
      volume = mount.target;
      // Postgres cannot start in the root of a mounted volume.
      if (mount.target === "/var/lib/postgresql/data" && !env.PGDATA) env.PGDATA = `${mount.target}/pgdata`;
    }

    const replicas = (definition.deploy as { replicas?: number } | undefined)?.replicas ?? 1;
    services.push({
      service,
      name,
      source,
      env,
      ...(startCommand ? { startCommand: startCommand.map(commandWord).join(" ") } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(health && health.port === port ? { healthcheckPath: health.path } : {}),
      replicas: volume ? 1 : Math.max(1, replicas),
      ...(volume ? { volume } : {}),
      ...(watchPatterns ? { watchPatterns } : {}),
      public: service === publicService,
    });
  }

  return { name: project.name, services, ignored: [...ignored].sort() };
}

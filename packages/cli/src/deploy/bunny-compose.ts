/**
 * Turns the resolved Compose project (`docker compose config --format json`)
 * into one Bunny Magic Containers app. Bunny runs every container of an app
 * in one pod: they share `localhost`, need distinct ports and scale
 * together, there is no DNS for service names, and an app has at most two
 * volumes. This module is pure, so it is tested on the template's output.
 */

export interface ComposeVolumeMount {
  type: string;
  source?: string;
  target: string;
  read_only?: boolean;
}

export interface ComposeService {
  image?: string;
  build?: { context: string; dockerfile?: string; target?: string; args?: Record<string, string> };
  command?: string[] | null;
  entrypoint?: string[] | null;
  working_dir?: string;
  environment?: Record<string, string | null>;
  volumes?: ComposeVolumeMount[];
  ports?: { target: number; published?: string; protocol?: string }[];
  healthcheck?: {
    test?: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
    disable?: boolean;
  };
  networks?: Record<string, { aliases?: string[] } | null>;
  [key: string]: unknown;
}

export interface ComposeProject {
  name: string;
  services: Record<string, ComposeService>;
}

/** An image the CLI builds and pushes to Bunny Container Registry. */
export interface PushedImage {
  source: "push";
  /** The repository under the account's namespace, such as site-backend. */
  repository: string;
}

/** A public image Bunny pulls itself. */
export interface PublicImage {
  source: "dockerHub" | "gitHub";
  namespace: string;
  name: string;
  tag: string;
  digest?: string;
}

export type ImageRef = PushedImage | PublicImage;

/** How the CLI makes a pushed image. */
export type ImageBuild =
  | {
      kind: "build";
      repository: string;
      context: string;
      dockerfile?: string;
      target?: string;
      args?: Record<string, string>;
    }
  | {
      /** An image-only service with bind-mounted files: the files are copied into the image. */
      kind: "bake";
      repository: string;
      from: string;
      files: { source: string; target: string; content: string }[];
    };

export interface ProbePlan {
  http?: { path: string; port: number };
  tcp?: { port: number };
  periodSeconds: number;
  timeoutSeconds: number;
  /** Failures before a ready container is taken out of traffic. */
  failureThreshold: number;
  /** Checks the startup probe allows before the container counts as failed. */
  startupThreshold: number;
}

export interface ContainerPlan {
  /** The Compose service. */
  service: string;
  /** The container's name on Bunny, such as backend for backend-prod. */
  name: string;
  image: ImageRef;
  env: Record<string, string>;
  /** Compose `entrypoint`. */
  command?: string[];
  /** Compose `command`. */
  args?: string[];
  workingDir?: string;
  ports: number[];
  probe?: ProbePlan;
  volumeMounts: { name: string; mountPath: string }[];
  /** The container port of the app's CDN endpoint, on the service with published ports. */
  endpoint?: number;
}

export interface AppPlan {
  name: string;
  containers: ContainerPlan[];
  volumes: string[];
  builds: ImageBuild[];
  /** Compose settings Bunny has no equivalent for; printed once. */
  ignored: string[];
}

export interface PlanOptions {
  /** Reads a bind-mounted file; throws when it is not a readable file. */
  readFile(path: string): string;
}

/** Volumes that are not needed on Bunny: its CDN holds the certificate, uploads and backups go to S3. */
export const DROPPED_VOLUMES = new Set(["caddy_data", "caddy_config", "backups", "media"]);

/** Compose keys that do not apply on Bunny: its gVisor sandbox isolates the app instead. */
const IGNORED_KEYS = [
  "read_only",
  "tmpfs",
  "cap_add",
  "cap_drop",
  "security_opt",
  "user",
  "deploy",
  "restart",
  "depends_on",
];

/** Bunny allows two volumes per app (one on a trial account). */
export const MAX_VOLUMES = 2;

/** Images whose port is set with PORT, so a clash with another service can move them. */
const PORT_ENV_IMAGES = [/(^|\/)umami(-software)?\/umami/i, /^umamisoftware\/umami/i];

/** Parses a Compose duration such as 5s, 1m0s or 500ms into seconds. */
export function durationSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|us|ns|h|m|s)/g)) {
    matched = true;
    const number = Number(amount);
    total +=
      unit === "h"
        ? number * 3600
        : unit === "m"
          ? number * 60
          : unit === "s"
            ? number
            : unit === "ms"
              ? number / 1000
              : 0;
  }
  return matched ? total : fallback;
}

/** Reads a public image reference: postgres:17-alpine, valkey/valkey:8, ghcr.io/owner/name:tag. */
export function parsePublicImage(reference: string): PublicImage {
  let rest = reference.trim();
  let digest: string | undefined;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  let source: PublicImage["source"] = "dockerHub";
  const slash = rest.indexOf("/");
  const first = slash >= 0 ? rest.slice(0, slash) : "";
  if (first && (first.includes(".") || first.includes(":") || first === "localhost")) {
    if (first === "docker.io" || first === "index.docker.io") source = "dockerHub";
    else if (first === "ghcr.io") source = "gitHub";
    else
      throw new Error(
        `Bunny pulls public images from Docker Hub and GitHub only; ${reference} is on ${first}. Push it to one of them, or build it in compose.yaml.`,
      );
    rest = rest.slice(slash + 1);
  }
  const colon = rest.lastIndexOf(":");
  const tag = colon > rest.lastIndexOf("/") ? rest.slice(colon + 1) : "latest";
  const path = colon > rest.lastIndexOf("/") ? rest.slice(0, colon) : rest;
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  const namespace = parts.join("/") || (source === "dockerHub" ? "library" : "");
  if (!name || !namespace) throw new Error(`Cannot read the image ${reference}.`);
  return { source, namespace, name, tag, ...(digest ? { digest } : {}) };
}

/** A repository name for Bunny Container Registry. */
export function repositoryName(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return cleaned || "app";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `name:port` where name is a whole host name, such as backend:8000 in http://backend:8000/api. */
function hostPattern(name: string): RegExp {
  return new RegExp(`(^|[^\\w.-])${escapeRegExp(name)}:(\\d{1,5})(?!\\d)`, "g");
}

/** The names other services reach a service by: its name and its network aliases. */
function hostNames(service: string, definition: ComposeService): string[] {
  const names = new Set([service]);
  for (const network of Object.values(definition.networks ?? {}))
    for (const alias of network?.aliases ?? []) names.add(alias);
  return [...names];
}

/** Replaces service host names with 127.0.0.1, which is the pod on Bunny. */
export function rewriteHosts(text: string, names: string[]): string {
  let result = text;
  for (const name of names)
    result = result.replace(
      hostPattern(name),
      (_whole, before: string, port: string) => `${before}127.0.0.1:${port}`,
    );
  return result;
}

function containerName(service: string, taken: Set<string>): string {
  let name = service.replace(/-prod$/, "").slice(0, 50) || service;
  for (let index = 2; taken.has(name); index++) name = `${service.slice(0, 46)}-${index}`;
  taken.add(name);
  return name;
}

function healthUrl(test: string[] | undefined): { port: number; path: string } | undefined {
  const text = (test ?? []).join(" ");
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(\/[^\s'"]*)?/);
  if (!match) return undefined;
  return { port: Number(match[1] ?? 80), path: match[2] ?? "/" };
}

function probeFor(definition: ComposeService, ports: number[]): ProbePlan | undefined {
  const check = definition.healthcheck;
  if (check?.disable) return undefined;
  const url = check?.test ? healthUrl(check.test) : undefined;
  const port = url?.port ?? ports[0];
  if (port === undefined) return undefined;
  const period = Math.max(1, Math.round(durationSeconds(check?.interval, 10)));
  const timeout = Math.max(1, Math.round(durationSeconds(check?.timeout, 5)));
  const retries = Math.max(1, check?.retries ?? 3);
  const start = durationSeconds(check?.start_period, 0);
  return {
    ...(url ? { http: { path: url.path, port } } : { tcp: { port } }),
    periodSeconds: period,
    timeoutSeconds: Math.min(timeout, period),
    failureThreshold: Math.min(3, retries),
    startupThreshold: Math.min(1000, Math.ceil(start / period) + retries),
  };
}

/** Plans the Bunny app for a resolved Compose project. */
export function planApp(project: ComposeProject, options: PlanOptions): AppPlan {
  // A service scaled to 0, such as the worker with TASK_WORKERS=0, does not run.
  const entries = Object.entries(project.services)
    .filter(([, definition]) => (definition.deploy as { replicas?: number } | undefined)?.replicas !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) throw new Error("compose.yaml has no services for production.");

  // Which names reach which service, and which ports other services use.
  const names = new Map<string, string[]>();
  for (const [service, definition] of entries) names.set(service, hostNames(service, definition));
  const allNames = [...names.values()].flat();

  const builds = new Map<string, ImageBuild>();
  const baked = new Map<string, string>(); // service -> rewritten bake files, scanned for ports
  const ignored = new Set<string>();
  const volumes = new Set<string>();
  const texts: string[] = [];

  for (const [, definition] of entries)
    for (const value of Object.values(definition.environment ?? {})) if (value) texts.push(value);

  // Bind-mounted files of image-only services are baked into an image.
  for (const [service, definition] of entries) {
    const binds = (definition.volumes ?? []).filter((mount) => mount.type === "bind");
    if (!binds.length) continue;
    if (definition.build || !definition.image)
      throw new Error(
        `${service} bind-mounts ${binds[0]?.source}; Bunny has no bind mounts. Copy the file into the image in its Dockerfile.`,
      );
    const files = binds.map((mount) => {
      let content: string;
      try {
        content = options.readFile(mount.source ?? "");
      } catch {
        throw new Error(
          `${service} bind-mounts ${mount.source}, which is not a file; Bunny has no bind mounts, so only files can be copied into the image.`,
        );
      }
      texts.push(content);
      return { source: mount.source ?? "", target: mount.target, content };
    });
    const repository = repositoryName(`${project.name}-${service.replace(/-prod$/, "")}`);
    builds.set(repository, { kind: "bake", repository, from: definition.image, files });
    baked.set(service, repository);
  }

  const portsOf = new Map<string, number[]>();
  for (const [service, definition] of entries) {
    const found = new Set<number>();
    for (const name of names.get(service) ?? [])
      for (const text of texts)
        for (const match of text.matchAll(hostPattern(name))) found.add(Number(match[2]));
    const own = definition.healthcheck?.test ? healthUrl(definition.healthcheck.test) : undefined;
    if (own) found.add(own.port);
    for (const port of definition.ports ?? []) found.add(port.target);
    portsOf.set(
      service,
      [...found].sort((a, b) => a - b),
    );
  }

  // Containers share one network namespace, so every port must be unique.
  const owner = new Map<number, string>();
  const moved = new Map<string, { from: number; to: number }>();
  for (const [service, definition] of entries) {
    const ports = portsOf.get(service) ?? [];
    for (const [index, port] of ports.entries()) {
      const other = owner.get(port);
      if (!other) {
        owner.set(port, service);
        continue;
      }
      const movable =
        ports.length === 1 && PORT_ENV_IMAGES.some((pattern) => pattern.test(definition.image ?? ""));
      if (!movable)
        throw new Error(
          `${other} and ${service} both listen on port ${port}. Bunny runs all containers of an app in one pod, so give one of them another port.`,
        );
      let to = port + 1;
      while (owner.has(to)) to++;
      owner.set(to, service);
      ports[index] = to;
      moved.set(service, { from: port, to });
    }
  }

  const published = entries.filter(([, definition]) => (definition.ports ?? []).length);
  if (published.length !== 1)
    throw new Error(
      published.length
        ? `${published.map(([service]) => service).join(" and ")} publish ports; Bunny gives an app one public endpoint, so only the proxy may.`
        : "No service publishes a port, so there is nothing for Bunny's CDN to send requests to.",
    );
  const [entryService, entryDefinition] = published[0] as [string, ComposeService];
  const entryPorts = (entryDefinition.ports ?? []).map((port) => port.target);
  const endpointPort = entryPorts.includes(80) ? 80 : (entryPorts[0] as number);

  // A moved port is rewritten where other services reach it.
  const rewrite = (text: string) => {
    let result = text;
    for (const [service, move] of moved)
      for (const name of names.get(service) ?? [])
        result = result.replace(hostPattern(name), (whole, before, port) =>
          Number(port) === move.from ? `${before}${name}:${move.to}` : whole,
        );
    return rewriteHosts(result, allNames);
  };
  for (const build of builds.values())
    if (build.kind === "bake") for (const file of build.files) file.content = rewrite(file.content);

  const s3 = entries.some(([, definition]) => Boolean(definition.environment?.S3_BUCKET));
  const taken = new Set<string>();
  const containers: ContainerPlan[] = [];
  for (const [service, definition] of entries) {
    for (const key of IGNORED_KEYS)
      if (definition[key] !== undefined && definition[key] !== null) ignored.add(key);

    let image: ImageRef;
    const bake = baked.get(service);
    if (bake) {
      image = { source: "push", repository: bake };
    } else if (definition.build) {
      const repository = repositoryName(definition.image ?? `${project.name}-${service}`);
      const existing = builds.get(repository);
      const build: ImageBuild = {
        kind: "build",
        repository,
        context: definition.build.context,
        dockerfile: definition.build.dockerfile,
        target: definition.build.target,
        args: definition.build.args,
      };
      if (existing && JSON.stringify(existing) !== JSON.stringify(build))
        throw new Error(
          `Two services build the image ${repository} differently; give them their own image names.`,
        );
      builds.set(repository, build);
      image = { source: "push", repository };
    } else if (definition.image) {
      image = parsePublicImage(definition.image);
    } else {
      throw new Error(`${service} has neither an image nor a build.`);
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(definition.environment ?? {})) {
      if (value === null || value === undefined || key === "COMPOSE_PROFILES" || key === "ENV_FILE") continue;
      env[key] = rewrite(value);
    }
    const move = moved.get(service);
    if (move) env.PORT = String(move.to);

    const volumeMounts: ContainerPlan["volumeMounts"] = [];
    for (const mount of definition.volumes ?? []) {
      if (mount.type === "tmpfs") continue;
      if (mount.type !== "volume" || !mount.source) {
        if (mount.type === "bind") continue; // Baked above.
        throw new Error(`${service} mounts a ${mount.type} volume, which Bunny does not have.`);
      }
      if (mount.source === "media" && !s3) {
        throw new Error(
          "Uploads must be in S3 on Bunny: its volumes belong to one pod and are not backed up. Set S3_BUCKET and the other S3_ variables in .env.production (see the docs on media).",
        );
      }
      if (DROPPED_VOLUMES.has(mount.source)) continue;
      volumes.add(mount.source);
      volumeMounts.push({ name: mount.source, mountPath: mount.target });
      // Postgres cannot start in the root of a mounted volume.
      if (mount.target === "/var/lib/postgresql/data" && !env.PGDATA) env.PGDATA = `${mount.target}/pgdata`;
    }

    const ports = portsOf.get(service) ?? [];
    containers.push({
      service,
      name: containerName(service, taken),
      image,
      env,
      ...(definition.entrypoint?.length ? { command: definition.entrypoint } : {}),
      ...(definition.command?.length ? { args: definition.command } : {}),
      ...(definition.working_dir ? { workingDir: definition.working_dir } : {}),
      ports,
      probe: probeFor(definition, move ? [move.to] : ports.filter((port) => port !== 443)),
      volumeMounts,
      ...(service === entryService ? { endpoint: endpointPort } : {}),
    });
  }

  if (volumes.size > MAX_VOLUMES)
    throw new Error(
      `Bunny allows ${MAX_VOLUMES} volumes per app, and this project needs ${volumes.size}: ${[...volumes].join(", ")}. Use an external Postgres or S3 for some of them.`,
    );

  return {
    name: project.name,
    containers,
    volumes: [...volumes],
    builds: [...builds.values()],
    ignored: [...ignored].sort(),
  };
}

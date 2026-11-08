import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "../env";
import { dockerNotRunning, isDockerDown } from "../tools";
import {
  type AppPlan,
  type ComposeProject,
  type ContainerPlan,
  type ImageBuild,
  type ProbePlan,
  planApp,
} from "./bunny-compose";
import { uncommittedReason } from "./link";
import type {
  AppState,
  AppStatus,
  DeployLink,
  Deployment,
  DeploymentStatus,
  DeployProvider,
  ProviderClient,
  SetupContext,
} from "./provider";
import { deployId, envValue, type RunResult } from "./ssh";

/**
 * Bunny Magic Containers (https://bunny.net/magic-containers), through the
 * API at https://api.bunny.net/mc with the account API key in the AccessKey
 * header. Bunny has no Compose: the CLI reads the resolved compose.yaml,
 * builds the images of the local commit for linux/amd64, pushes them to
 * Bunny Container Registry and creates one app whose containers are the
 * production services, in one pod on localhost. A CDN endpoint on the
 * proxy carries the site's domain; Bunny's CDN holds the certificate, so
 * Caddy serves plain HTTP on port 80. A deploy pushes new images tagged with
 * the commit and changes the containers' tags, which starts Bunny's rolling
 * update.
 *
 * Link ids: project = the app id, environment = the account's registry
 * namespace, application = the CDN pull zone id.
 */

export const BUNNY_API = "https://api.bunny.net";
export const BUNNY_REGISTRY = "registry.bunny.net";

/** Variables that put Caddy behind Bunny's CDN. TRUSTED_PROXIES is Bunny's edge list, set in setup. */
export const BUNNY_PLATFORM_ENV: Record<string, string> = {
  CADDY_ADDRESS: ":80",
  NUM_PROXIES: "2",
};

/** Where a deploy's record and log are kept, in the project. Bunny keeps no deploy history. */
export const BUNNY_DEPLOYS_DIR = ".dstack/deploys";

/** Pushed tags kept for rollbacks. */
export const KEEP_DEPLOYS = 20;

import type { Fetch } from "./coolify";

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  input?: Buffer | string;
  /** Shows the output while it runs, as for a build. */
  stream?: boolean;
}

/** Runs a command; resolves with its exit code and output. */
export type CommandRunner = (command: string, args: string[], options?: CommandOptions) => Promise<RunResult>;

export const systemRunner: CommandRunner = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (options.stream) process.stderr.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (options.stream) process.stderr.write(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === "ENOENT"
            ? `There is no ${command} command here.${command === "docker" ? " Install Docker: https://docs.docker.com/get-docker/" : ""}`
            : `Could not run ${command}: ${error.message}`,
        ),
      ),
    );
    child.on("close", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });

/** The production Compose project, resolved with the variables, as JSON. */
export async function resolveCompose(
  run: CommandRunner,
  directory: string,
  env: Record<string, string>,
): Promise<ComposeProject> {
  const folder = mkdtempSync(join(tmpdir(), "dstack-env-"));
  const file = join(folder, ".env");
  writeFileSync(
    file,
    `${Object.entries(env)
      .map(([key, value]) => `${key}=${envValue(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  const args = ["compose", "--env-file", file, "config", "--format", "json"];
  try {
    const result = await run("docker", args, { cwd: directory, env: { ...env, ENV_FILE: file } });
    if (result.code !== 0) {
      if (isDockerDown(`${result.stderr}\n${result.stdout}`)) throw new Error(dockerNotRunning());
      const last = (result.stderr.trim() || result.stdout.trim()).split("\n").at(-1) ?? "";
      throw new Error(`docker compose failed (exit ${result.code})${last ? `: ${last}` : "."}`);
    }
    return JSON.parse(result.stdout) as ComposeProject;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export class BunnyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

/** The items of a list response: an array, or an object with items, data or a similar key. */
export function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (value && typeof value === "object") {
    for (const key of [
      "items",
      "Items",
      "data",
      "applications",
      "registries",
      "containerRegistries",
      "endpoints",
      "regions",
    ]) {
      const items = (value as Json)[key];
      if (Array.isArray(items)) return items as Json[];
    }
  }
  return [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
}

/** The first value under a key that matches, searched depth first. */
export function findKey(value: unknown, pattern: RegExp): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value as Json))
    if (pattern.test(key) && item != null && item !== "") return item;
  for (const item of Object.values(value as Json)) {
    const found = findKey(item, pattern);
    if (found !== undefined) return found;
  }
  return undefined;
}

export class BunnyApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
    readonly base = BUNNY_API,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          AccessKey: this.token,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Could not reach ${this.base}: ${(error as Error).message}`);
    }
    const raw = await response.text();
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : undefined;
    } catch {
      data = raw;
    }
    if (response.ok) return data as T;
    if (response.status === 401 || (response.status === 403 && !raw))
      throw new BunnyError(
        "Bunny refused the API key. Use the key of your account (not a sub-user's) from https://dash.bunny.net/account/api-key.",
        response.status,
      );
    throw new BunnyError(
      `Bunny answered ${response.status} to ${method} ${path}: ${errorText(data)}`,
      response.status,
    );
  }

  /** The Magic Containers API. */
  mc<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, `/mc${path}`, body);
  }
}

function errorText(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 300) || "no details";
  if (data && typeof data === "object") {
    const value = data as Json;
    const parts = [value.title, value.detail, value.message, value.Message, value.error]
      .map((item) => text(item))
      .filter(Boolean);
    const errors = value.errors;
    if (errors && typeof errors === "object")
      for (const [key, messages] of Object.entries(errors as Json))
        parts.push(`${key}: ${Array.isArray(messages) ? messages.join(" ") : String(messages)}`);
    if (parts.length) return parts.join("; ");
  }
  return "no details";
}

/** A Bunny probe from a planned one. */
function probeRequest(probe: ProbePlan, failureThreshold: number) {
  const check = probe.http
    ? {
        httpGet: {
          request: { path: probe.http.path, portNumber: probe.http.port },
          response: { expectedStatusCode: "ok" },
        },
      }
    : { tcpSocket: { request: { portNumber: probe.tcp?.port } } };
  return {
    initialDelaySeconds: 1,
    periodSeconds: probe.periodSeconds,
    timeoutSeconds: probe.timeoutSeconds,
    failureThreshold,
    successThreshold: 1,
    ...check,
  };
}

/**
 * Which registry a Magic Containers registry is. Bunny returns no type, so
 * this goes by the host name, and by the display name or a type field when
 * there is no host name. Public Docker Hub and GitHub are built in.
 */
export function registryKind(item: Record<string, unknown>): keyof Registries | undefined {
  const host = (text(item.hostName) ?? text(item.host) ?? text(item.url) ?? "").toLowerCase();
  const label = `${text(item.type) ?? ""} ${text(item.displayName) ?? ""}`
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (host) {
    if (/(^|\.|\/)(docker\.io|docker\.com)(\/|$)/.test(host)) return "dockerHub";
    if (/(^|\.|\/)ghcr\.io(\/|$)/.test(host)) return "gitHub";
    if (/(^|\.|\/)bunny\.net(\/|$)/.test(host)) return "bunny";
    return undefined;
  }
  if (label.includes("dockerhub")) return "dockerHub";
  if (label.includes("github") || label.includes("ghcr")) return "gitHub";
  if (label.includes("bunny")) return "bunny";
  return undefined;
}

export interface Registries {
  dockerHub: string;
  gitHub?: string;
  bunny: string;
}

export interface AppRequestOptions {
  registries: Registries;
  /** The account's namespace in Bunny Container Registry. */
  namespace: string;
  tag: string;
  region: string;
  volumeSize: number;
}

/** The image fields of a container. */
export function imageFields(
  container: ContainerPlan,
  options: Omit<AppRequestOptions, "region" | "volumeSize">,
) {
  const { image } = container;
  if (image.source === "push")
    return {
      imageRegistryId: options.registries.bunny,
      imageNamespace: options.namespace,
      imageName: image.repository,
      imageTag: options.tag,
    };
  const registry = image.source === "gitHub" ? options.registries.gitHub : options.registries.dockerHub;
  if (!registry)
    throw new Error(
      `There is no public ${image.source === "gitHub" ? "GitHub" : "Docker Hub"} registry in Bunny.`,
    );
  return {
    imageRegistryId: registry,
    imageNamespace: image.namespace,
    imageName: image.name,
    imageTag: image.tag,
    ...(image.digest ? { imageDigest: image.digest } : {}),
  };
}

/** The body of POST /apps for a planned app. */
export function appRequest(plan: AppPlan, options: AppRequestOptions) {
  return {
    name: plan.name.replace(/[^A-Za-z0-9-\s]+/g, "-").slice(0, 100),
    runtimeType: "shared",
    // A pod with Postgres and Valkey cannot be replicated: one instance in one region.
    autoScaling: { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: [options.region],
      requiredRegionIds: [options.region],
      maxAllowedRegions: 1,
    },
    containerTemplates: plan.containers.map((container) => ({
      name: container.name,
      ...imageFields(container, options),
      imagePullPolicy: "ifNotPresent",
      ...(container.command || container.args || container.workingDir
        ? {
            entryPoint: {
              ...(container.command ? { commandArray: container.command } : {}),
              ...(container.args ? { argumentsArray: container.args } : {}),
              ...(container.workingDir ? { workingDirectory: container.workingDir } : {}),
            },
          }
        : {}),
      environmentVariables: envList(container.env),
      ...(container.probe
        ? {
            probes: {
              startup: probeRequest(container.probe, container.probe.startupThreshold),
              readiness: probeRequest(container.probe, container.probe.failureThreshold),
            },
          }
        : {}),
      ...(container.endpoint
        ? {
            endpoints: [
              {
                displayName: "site",
                cdn: { isSslEnabled: false, portMappings: [{ containerPort: container.endpoint }] },
              },
            ],
          }
        : {}),
      ...(container.volumeMounts.length ? { volumeMounts: container.volumeMounts } : {}),
    })),
    ...(plan.volumes.length
      ? { volumes: plan.volumes.map((name) => ({ name, size: options.volumeSize })) }
      : {}),
  };
}

export function envList(env: Record<string, string>) {
  return Object.entries(env).map(([name, value]) => ({ name, value }));
}

/** A record of a deploy, written by the CLI next to its log. */
export interface BunnyDeployRecord {
  id: string;
  /** The image tag the containers run. */
  tag: string;
  commit?: string;
  message?: string;
  createdAt: string;
  /** Set when the deploy failed on this machine, before Bunny took it. */
  failed?: boolean;
  rollbackOf?: string;
}

/** Bunny's word for an app's state, read from the fields its API returns. */
export function bunnyState(value: string | undefined): AppState {
  const word = (value ?? "").toLowerCase();
  if (!word) return "unknown";
  if (/fail|error|crash|unhealthy|degrad/.test(word)) return "degraded";
  if (/stop|suspend|undeploy|inactive|paused|deleted/.test(word)) return "stopped";
  if (/run|active|healthy|^ok$|ready|deployed|online/.test(word)) return "running";
  return "unknown";
}

/** Whether Bunny is still rolling out. */
export function bunnyBusy(value: string | undefined): boolean {
  return /deploying|progress|updat|pending|creat|start|provision|rolling|scaling/i.test(value ?? "");
}

interface BunnyContainer {
  id: string;
  name: string;
  imageNamespace?: string;
  imageName?: string;
  imageTag?: string;
}

function appContainers(app: unknown): BunnyContainer[] {
  const value = app as Json | undefined;
  const list = listOf(value?.containerTemplates ?? value?.containers ?? []);
  return list
    .map((item) => ({
      id: text(item.id) ?? "",
      name: text(item.name) ?? "",
      imageNamespace: text(item.imageNamespace),
      imageName: text(item.imageName),
      imageTag: text(item.imageTag),
    }))
    .filter((item) => item.id && item.name);
}

function appStatusText(app: unknown): string | undefined {
  const value = app as Json | undefined;
  for (const key of ["status", "state", "appStatus", "displayStatus", "deploymentStatus"]) {
    const item = value?.[key];
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const nested = text((item as Json).status ?? (item as Json).state ?? (item as Json).name);
      if (nested) return nested;
    }
  }
  return undefined;
}

export interface BunnyClientOptions {
  run?: CommandRunner;
  /** Reads the Bunny edge server addresses for TRUSTED_PROXIES. */
  edgeServers?: () => Promise<string[]>;
  now?: () => Date;
  /** Reads a file that compose.yaml bind-mounts. */
  readFile?: (path: string) => string;
}

export class BunnyClient implements ProviderClient {
  readonly api: BunnyApi;
  private readonly token: string;
  private readonly run: CommandRunner;
  private readonly now: () => Date;
  private readonly readFile: (path: string) => string;
  private readonly edgeServersImpl: () => Promise<string[]>;

  constructor(
    token: string,
    private readonly fetchImpl: Fetch = fetch,
    options: BunnyClientOptions = {},
  ) {
    this.api = new BunnyApi(token, fetchImpl);
    this.token = token;
    this.run = options.run ?? systemRunner;
    this.now = options.now ?? (() => new Date());
    this.readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
    this.edgeServersImpl = options.edgeServers ?? (() => this.defaultEdgeServers());
  }

  async verify(): Promise<string> {
    const apps = listOf(await this.api.mc("GET", "/apps"));
    return `Magic Containers (${apps.length} app${apps.length === 1 ? "" : "s"})`;
  }

  // Docker -------------------------------------------------------------------

  private async docker(args: string[], options: CommandOptions = {}): Promise<string> {
    const result = await this.run("docker", args, options);
    if (result.code === 0) return result.stdout;
    if (isDockerDown(`${result.stderr}\n${result.stdout}`)) throw new Error(dockerNotRunning());
    const last = (result.stderr.trim() || result.stdout.trim()).split("\n").at(-1) ?? "";
    throw new Error(`docker ${args[0]} failed (exit ${result.code})${last ? `: ${last}` : "."}`);
  }

  private async git(directory: string, args: string[]): Promise<RunResult> {
    return this.run("git", ["-C", directory, ...args]);
  }

  /** The short commit and its subject. */
  private async commit(directory: string): Promise<{ commit: string; message: string }> {
    const result = await this.git(directory, ["log", "-1", "--format=%h%n%s"]);
    if (result.code !== 0)
      throw new Error("This project has no commit yet. Commit it first: git add -A && git commit");
    const [commit = "", message = ""] = result.stdout.trim().split("\n");
    return { commit, message };
  }

  /** Extracts the local commit into a temporary directory, so the images match the commit. */
  private async checkout(directory: string): Promise<string> {
    const target = mkdtempSync(join(tmpdir(), "dstack-bunny-"));
    const archive = await this.git(directory, [
      "archive",
      "--format=tar",
      "-o",
      join(target, ".archive.tar"),
      "HEAD",
    ]);
    if (archive.code !== 0) {
      rmSync(target, { recursive: true, force: true });
      throw new Error(`git archive failed: ${archive.stderr.trim().split("\n").at(-1) ?? ""}`);
    }
    const extract = await this.run("tar", ["-x", "-f", ".archive.tar"], { cwd: target });
    rmSync(join(target, ".archive.tar"), { force: true });
    if (extract.code !== 0) {
      rmSync(target, { recursive: true, force: true });
      throw new Error(`Could not extract the commit: ${extract.stderr.trim()}`);
    }
    return target;
  }

  /** The production Compose project, resolved with the variables, as JSON. */
  async composeConfig(directory: string, env: Record<string, string>): Promise<ComposeProject> {
    return resolveCompose(this.run, directory, env);
  }

  async plan(directory: string, env: Record<string, string>): Promise<AppPlan> {
    const project = await this.composeConfig(directory, env);
    return planApp(project, { readFile: this.readFile });
  }

  /** Builds an image for linux/amd64 and pushes it to Bunny Container Registry. */
  private async buildAndPush(build: ImageBuild, reference: string, directory: string) {
    if (build.kind === "build") {
      await this.docker(
        [
          "build",
          "--platform",
          "linux/amd64",
          ...(build.target ? ["--target", build.target] : []),
          ...(build.dockerfile ? ["-f", resolve(build.context, build.dockerfile)] : []),
          ...Object.entries(build.args ?? {}).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`]),
          "-t",
          reference,
          build.context,
        ],
        { cwd: directory, stream: true },
      );
    } else {
      const context = mkdtempSync(join(tmpdir(), "dstack-bake-"));
      try {
        const lines = [`FROM ${build.from}`];
        build.files.forEach((file, index) => {
          writeFileSync(join(context, `file-${index}`), file.content);
          lines.push(`COPY file-${index} ${file.target}`);
        });
        writeFileSync(join(context, "Dockerfile"), `${lines.join("\n")}\n`);
        await this.docker(["build", "--platform", "linux/amd64", "-t", reference, context], { stream: true });
      } finally {
        rmSync(context, { recursive: true, force: true });
      }
    }
    // Log in with a throwaway Docker config, so the API key is not left in ~/.docker.
    const config = mkdtempSync(join(tmpdir(), "dstack-docker-"));
    try {
      await this.docker(["login", BUNNY_REGISTRY, "--username", "token", "--password-stdin"], {
        env: { DOCKER_CONFIG: config },
        input: this.token,
      });
      await this.docker(["push", reference], { env: { DOCKER_CONFIG: config }, stream: true });
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  }

  /** Builds and pushes every image of the local commit; returns the plan of the commit. */
  private async pushImages(
    directory: string,
    env: Record<string, string>,
    namespace: string,
    tag: string,
    log: (line: string) => void,
  ): Promise<AppPlan> {
    const checkout = await this.checkout(directory);
    try {
      // .env.production is not in the commit; Compose reads it from the variables.
      const plan = await this.plan(checkout, env);
      for (const build of plan.builds) {
        const reference = `${BUNNY_REGISTRY}/${namespace}/${build.repository}:${tag}`;
        log(`Building and pushing ${reference}`);
        await this.buildAndPush(build, reference, checkout);
      }
      return plan;
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  }

  // Bunny resources ------------------------------------------------------------

  async registries(): Promise<{ registries: Partial<Registries>; namespace?: string; listed: string[] }> {
    const list = listOf(await this.api.mc("GET", "/registries"));
    const registries: Partial<Registries> = {};
    let namespace: string | undefined;
    const listed: string[] = [];
    // Public registries first, so a private Docker Hub login is only a fallback.
    const ordered = [...list].sort((a, b) => Number(b.isPublic === true) - Number(a.isPublic === true));
    for (const item of ordered) {
      const id = text(item.id);
      if (!id) continue;
      const kind = registryKind(item);
      listed.push(text(item.displayName) ?? text(item.hostName) ?? id);
      if (kind === "dockerHub" && !registries.dockerHub) registries.dockerHub = id;
      else if (kind === "gitHub" && !registries.gitHub) registries.gitHub = id;
      else if (kind === "bunny" && !registries.bunny) {
        registries.bunny = id;
        namespace = text(item.namespace ?? item.accountId ?? item.userName ?? item.username);
      }
    }
    return { registries, namespace, listed };
  }

  private async ensureRegistries(): Promise<{ registries: Registries; namespace?: string }> {
    const found = await this.registries();
    if (!found.registries.dockerHub)
      throw new Error(
        `Could not find the public Docker Hub registry among the registries Bunny returned (${found.listed.join(", ") || "none"}). Please report this at https://github.com/dwarsbit/django-stack/issues.`,
      );
    if (!found.registries.bunny) {
      const created = await this.api.mc<Json>("POST", "/registries", {
        displayName: "Bunny Container Registry",
        type: "bunnyRegistry",
      });
      const id = text(created?.id) ?? text(findKey(created, /^id$/i));
      if (!id) throw new Error("Could not add Bunny Container Registry to Magic Containers.");
      found.registries.bunny = id;
    }
    return { registries: found.registries as Registries, namespace: found.namespace };
  }

  async app(link: DeployLink): Promise<Json> {
    return (await this.api.mc<Json>("GET", `/apps/${encodeURIComponent(link.project)}`)) ?? {};
  }

  private async defaultEdgeServers(): Promise<string[]> {
    const addresses: string[] = [];
    for (const path of ["/system/edgeserverlist", "/system/edgeserverlist/ipv6"]) {
      const response = await this.fetchImpl(`${BUNNY_API}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Bunny answered ${response.status} to ${path}`);
      const list = (await response.json()) as unknown;
      if (Array.isArray(list)) for (const item of list) if (typeof item === "string") addresses.push(item);
    }
    return addresses;
  }

  /** TRUSTED_PROXIES for Caddy: the addresses Bunny's CDN connects from. */
  async trustedProxies(): Promise<string | undefined> {
    try {
      const addresses = await this.edgeServersImpl();
      return addresses.length ? addresses.join(" ") : undefined;
    } catch {
      return undefined;
    }
  }

  private async pullZoneId(appId: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const endpoints = await this.api.mc("GET", `/apps/${encodeURIComponent(appId)}/endpoints`);
      const id = text(findKey(endpoints, /^pull_?zone_?id$/i));
      if (id && id !== "0") return id;
      await new Promise((done) => setTimeout(done, attempt ? 3000 : 1000));
    }
    return undefined;
  }

  async pullZone(id: string): Promise<Json> {
    return (await this.api.request<Json>("GET", `/pullzone/${encodeURIComponent(id)}`)) ?? {};
  }

  /** The custom hostname, its certificate and a cache bypass for pages that must not be cached. */
  async setupPullZone(id: string, domain: string, step: (message: string) => void): Promise<void> {
    const zone = `/pullzone/${encodeURIComponent(id)}`;
    // Django checks the Host header against the site's domain, so the CDN forwards it.
    await this.api.request("POST", zone, { AddHostHeader: true });
    const current = await this.pullZone(id);
    const hostnames = listOf(current.Hostnames).map((item) => text(item.Value)?.toLowerCase());
    if (!hostnames.includes(domain.toLowerCase())) {
      await this.api.request("POST", `${zone}/addHostname`, { Hostname: domain });
      step(`Added ${domain} to the CDN pull zone`);
    }
    // The admin, the API and the analytics tracker are never served from the edge cache.
    await this.api.request("POST", `${zone}/edgerules/addOrUpdate`, {
      ActionType: 3,
      ActionParameter1: "0",
      ActionParameter2: "0",
      Triggers: [
        {
          Type: 0,
          PatternMatches: ["*/admin", "*/admin/*", "*/api", "*/api/*", "*/_a/*"],
          PatternMatchingType: 0,
        },
      ],
      TriggerMatchingType: 0,
      Description: "dstack: do not cache the admin, the API and analytics",
      Enabled: true,
    });
    await this.certificate(id, domain);
  }

  /** Requests the free certificate once DNS points at the CDN; returns whether it is active. */
  async certificate(id: string, domain: string): Promise<boolean> {
    const zone = await this.pullZone(id);
    const hostname = listOf(zone.Hostnames).find(
      (item) => text(item.Value)?.toLowerCase() === domain.toLowerCase(),
    );
    if (hostname?.HasCertificate === true) return true;
    try {
      await this.api.request("GET", `/pullzone/loadFreeCertificate?hostname=${encodeURIComponent(domain)}`);
      await this.api.request("POST", `/pullzone/${encodeURIComponent(id)}/setForceSSL`, {
        Hostname: domain,
        ForceSSL: true,
      });
      return true;
    } catch {
      return false; // Usually the DNS record is not there yet.
    }
  }

  private async cname(id: string): Promise<string | undefined> {
    const zone = await this.pullZone(id);
    const name = text(zone.Name);
    return name ? `${name}.b-cdn.net` : undefined;
  }

  // Records ----------------------------------------------------------------------

  private recordsDir(directory: string): string {
    const folder = join(directory, BUNNY_DEPLOYS_DIR);
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
      // Records are local to this machine; keep them out of git.
      writeFileSync(join(folder, ".gitignore"), "*\n");
    }
    return folder;
  }

  private writeRecord(directory: string, record: BunnyDeployRecord, log: string[]) {
    const folder = this.recordsDir(directory);
    writeFileSync(join(folder, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(folder, `${record.id}.log`), log.length ? `${log.join("\n")}\n` : "");
  }

  private records(directory: string): BunnyDeployRecord[] {
    const folder = join(directory, BUNNY_DEPLOYS_DIR);
    if (!existsSync(folder)) return [];
    const records: BunnyDeployRecord[] = [];
    for (const file of readdirSync(folder)) {
      if (!file.endsWith(".json")) continue;
      try {
        records.push(JSON.parse(readFileSync(join(folder, file), "utf8")) as BunnyDeployRecord);
      } catch {
        // Not written by dstack.
      }
    }
    return records.sort((a, b) => b.id.localeCompare(a.id));
  }

  // ProviderClient ---------------------------------------------------------------

  async setup(context: SetupContext) {
    const { ask, options } = context;
    const { directory } = context;
    const volumeSize = Number.parseInt(options.volumeSize ?? "10", 10);
    if (!Number.isFinite(volumeSize) || volumeSize < 1 || volumeSize > 100)
      throw new Error("Give --volume-size in GB, from 1 to 100.");

    const env = { ...context.env };
    const trusted = await this.trustedProxies();
    if (trusted) env.TRUSTED_PROXIES = trusted;
    else
      ask.step(
        "Could not read Bunny's edge server list; Django may see the CDN's address instead of the client's. Run dstack deploy env push later.",
      );

    // Check the plan before anything is created.
    const local = await this.plan(directory, env);
    if (local.ignored.length)
      ask.step(
        `Bunny runs the app in a gVisor sandbox; not applied from compose.yaml: ${local.ignored.join(", ")}`,
      );

    const { registries, namespace: found } = await this.ensureRegistries();
    let namespace = options.account ?? found;
    if (!namespace)
      namespace = (
        await ask.text("Bunny account id (Magic Containers › Image Registries, or bunny whoami)", {
          placeholder: "123456",
        })
      ).trim();
    if (!/^[\w.-]+$/.test(namespace)) throw new Error(`${namespace} is not a Bunny account id.`);

    let region = options.region;
    if (!region) {
      const optimal = text(
        findKey(await this.api.mc("GET", "/regions/optimal").catch(() => undefined), /^id$|regionid/i),
      );
      const regions = listOf(await this.api.mc("GET", "/regions"))
        .map((item) => ({ value: text(item.id) ?? "", label: text(item.name) ?? text(item.id) ?? "" }))
        .filter((item) => item.value);
      if (regions.length) region = await ask.select("Region", regions, optimal ?? regions[0]?.value);
      else region = optimal;
    }
    if (!region) throw new Error("Pass --region, such as DE.");

    const { commit, message } = await this.commit(directory);
    const uncommitted = uncommittedReason(directory);
    if (uncommitted)
      ask.step(`Building the last commit, ${commit}: ${uncommitted.replace(/ Commit first\.$/, "")}`);
    const log: string[] = [];
    const plan = await this.pushImages(directory, env, namespace, commit, (line) => {
      log.push(line);
      ask.step(line);
    });

    const created = await this.api.mc<Json>(
      "POST",
      "/apps",
      appRequest(plan, { registries, namespace, tag: commit, region, volumeSize }),
    );
    const appId = text(created?.id);
    if (!appId) throw new Error("Bunny created the app but returned no id.");
    ask.step(`Created the app ${plan.name} in ${region}`);
    try {
      await this.api.mc("POST", `/apps/${encodeURIComponent(appId)}/deploy`);
    } catch (error) {
      // Some accounts deploy a new app right away; a conflict means it already runs.
      if (!(error instanceof BunnyError && [400, 409].includes(error.status))) throw error;
    }

    const zone = await this.pullZoneId(appId);
    if (!zone)
      throw new Error(
        `Bunny has not created the CDN endpoint of app ${appId} yet. Run dstack deploy setup --force later.`,
      );
    await this.setupPullZone(zone, context.domain, ask.step);
    const target = await this.cname(zone);
    ask.step(
      `Add this DNS record: ${context.domain} CNAME ${target ?? "the pull zone's b-cdn.net address"}${
        context.domain.split(".").length === 2
          ? " (an apex domain needs Bunny DNS, or use www and redirect)"
          : ""
      }`,
    );

    this.writeRecord(
      directory,
      { id: deployId(this.now(), commit), tag: commit, commit, message, createdAt: this.now().toISOString() },
      log,
    );
    return { project: appId, environment: namespace, application: zone };
  }

  async pushEnv(link: DeployLink, env: Record<string, string>): Promise<void> {
    const directory = projectDirectory(link);
    const values = { ...env };
    const trusted = await this.trustedProxies();
    if (trusted) values.TRUSTED_PROXIES = trusted;
    const plan = await this.plan(directory, values);
    const containers = appContainers(await this.app(link));
    for (const container of plan.containers) {
      const remote = containers.find((item) => item.name === container.name);
      if (!remote) throw new Error(missingContainer(container.name));
      await this.api.mc(
        "PUT",
        `/apps/${encodeURIComponent(link.project)}/containers/${encodeURIComponent(remote.id)}/env`,
        { environmentVariables: envList(container.env) },
      );
    }
  }

  async deploy(link: DeployLink, options: { force: boolean; directory: string }): Promise<string> {
    const { directory } = options;
    const { commit, message } = await this.commit(directory);
    const id = deployId(this.now(), commit);
    const log: string[] = [];
    const record: BunnyDeployRecord = {
      id,
      tag: commit,
      commit,
      message,
      createdAt: this.now().toISOString(),
    };
    const containers = appContainers(await this.app(link));
    const env = { ...productionEnv(directory), ...BUNNY_PLATFORM_ENV };
    try {
      const local = await this.plan(directory, env);
      const pushed = local.containers.filter((container) => container.image.source === "push");
      for (const container of local.containers)
        if (!containers.some((item) => item.name === container.name))
          throw new Error(missingContainer(container.name));
      const current = pushed.every(
        (container) => containers.find((item) => item.name === container.name)?.imageTag === commit,
      );
      if (current) {
        if (options.force) {
          await this.api.mc("POST", `/apps/${encodeURIComponent(link.project)}/restart`);
          log.push(`Restarted the app on ${commit}`);
        } else {
          log.push(`The app already runs ${commit}; nothing to deploy. Pass --force to restart it.`);
        }
      } else {
        await this.pushImages(directory, env, link.environment, commit, (line) => {
          log.push(line);
          process.stderr.write(`${line}\n`);
        });
        await this.retag(
          link,
          containers,
          pushed.map((container) => container.name),
          commit,
        );
        log.push(`Bunny is rolling out ${commit}`);
      }
      if (link.application) {
        const domain = (env.SITE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
        if (domain) await this.certificate(link.application, domain).catch(() => false);
      }
    } catch (error) {
      log.push((error as Error).message);
      this.writeRecord(directory, { ...record, failed: true }, log);
      throw error;
    }
    this.writeRecord(directory, record, log);
    this.prune(directory);
    return id;
  }

  /** Points the containers of pushed images at a tag; Bunny starts a rolling update. */
  private async retag(link: DeployLink, remote: BunnyContainer[], names: string[], tag: string) {
    for (const name of names) {
      const item = remote.find((entry) => entry.name === name);
      if (!item || item.imageTag === tag) continue;
      await this.api.mc(
        "PATCH",
        `/apps/${encodeURIComponent(link.project)}/containers/${encodeURIComponent(item.id)}`,
        { imageTag: tag },
      );
    }
  }

  /** Removes records beyond KEEP_DEPLOYS. Their images stay in the registry. */
  private prune(directory: string) {
    const folder = join(directory, BUNNY_DEPLOYS_DIR);
    for (const record of this.records(directory).slice(KEEP_DEPLOYS)) {
      rmSync(join(folder, `${record.id}.json`), { force: true });
      rmSync(join(folder, `${record.id}.log`), { force: true });
    }
  }

  async rollback(link: DeployLink, to?: string): Promise<string> {
    const directory = projectDirectory(link);
    const records = this.records(directory);
    const containers = appContainers(await this.app(link));
    const pushed = containers.filter((item) => isPushed(item, link));
    const currentTag = pushed[0]?.imageTag;
    let target: BunnyDeployRecord | undefined;
    if (to) {
      target = records.find((item) => item.id === to || item.tag === to);
      if (!target) throw new Error(`There is no deploy ${to} in ${BUNNY_DEPLOYS_DIR}.`);
    } else {
      target = records.find((item) => !item.failed && item.tag !== currentTag);
      if (!target) throw new Error("There is no earlier deploy to roll back to.");
    }
    if (target.failed) throw new Error(`Deploy ${target.id} failed, so its images may not exist.`);
    const id = deployId(this.now(), "rollback");
    await this.retag(
      link,
      containers,
      pushed.map((item) => item.name),
      target.tag,
    );
    this.writeRecord(
      directory,
      {
        id,
        tag: target.tag,
        commit: target.commit,
        message: `Rollback to ${target.id}`,
        createdAt: this.now().toISOString(),
        rollbackOf: target.id,
      },
      [`Bunny is rolling out ${target.tag}`],
    );
    return id;
  }

  /** The tag the app's own images run, and Bunny's state. */
  private async current(link: DeployLink): Promise<{ tag?: string; status?: string }> {
    const app = await this.app(link);
    const containers = appContainers(app).filter((item) => isPushed(item, link));
    return { tag: containers[0]?.imageTag, status: appStatusText(app) };
  }

  private statusOf(
    record: BunnyDeployRecord,
    latest: boolean,
    current: { tag?: string; status?: string },
  ): DeploymentStatus {
    if (record.failed) return "failed";
    if (record.tag === current.tag && latest) {
      if (bunnyBusy(current.status)) return "building";
      const state = bunnyState(current.status);
      if (state === "running" || state === "unknown") return "finished";
      return "failed";
    }
    if (latest) {
      // Bunny has not taken the new tag yet.
      const age = this.now().getTime() - new Date(record.createdAt).getTime();
      return age < 120_000 ? "queued" : "failed";
    }
    return "finished";
  }

  async deployment(link: DeployLink, id: string): Promise<Deployment> {
    const directory = projectDirectory(link);
    const records = this.records(directory);
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error(`There is no deploy ${id} in ${BUNNY_DEPLOYS_DIR}.`);
    const current = await this.current(link);
    const logFile = join(directory, BUNNY_DEPLOYS_DIR, `${id}.log`);
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8").replace(/\n$/, "") : "";
    return {
      ...toDeployment(record, this.statusOf(record, records[0]?.id === id, current), link),
      log: log ? log.split("\n").map((line) => ({ text: line, stderr: false })) : [],
    };
  }

  async deployments(link: DeployLink, limit: number): Promise<Deployment[]> {
    const records = this.records(projectDirectory(link)).slice(0, Math.max(1, limit));
    if (!records.length) return [];
    const current = await this.current(link);
    return records.map((record, index) => ({
      ...toDeployment(record, this.statusOf(record, index === 0, current), link),
      log: [],
    }));
  }

  async status(link: DeployLink): Promise<AppStatus> {
    const app = await this.app(link);
    const word = appStatusText(app);
    const state = bunnyBusy(word) ? "degraded" : bunnyState(word);
    const details = [word ?? "no status"];
    const domains: string[] = [];
    if (link.application) {
      try {
        const zone = await this.pullZone(link.application);
        for (const item of listOf(zone.Hostnames)) {
          const host = text(item.Value);
          if (!host || item.IsSystemHostname === true || host.endsWith(".b-cdn.net")) continue;
          domains.push(`https://${host}`);
          if (item.HasCertificate !== true)
            details.push(`no certificate for ${host} yet: check its DNS record`);
        }
      } catch {
        details.push("could not read the CDN pull zone");
      }
    }
    return { state, detail: details.join(", "), domains, url: dashboardUrl(link) };
  }
}

function missingContainer(name: string): string {
  return `The app on Bunny has no container ${name}. compose.yaml changed since setup: run dstack deploy setup --force to create the app again.`;
}

/** Whether a Bunny container runs an image this project pushes: one in the account's namespace. */
function isPushed(container: BunnyContainer, link: DeployLink): boolean {
  return container.imageNamespace === link.environment;
}

/** The project directory, where the deploy records are. */
function projectDirectory(link: DeployLink): string {
  return link.directory ?? process.cwd();
}

export function dashboardUrl(link: DeployLink): string {
  return `https://dash.bunny.net/magic-containers/apps/${encodeURIComponent(link.project)}`;
}

function toDeployment(
  record: BunnyDeployRecord,
  status: DeploymentStatus,
  link: DeployLink,
): Omit<Deployment, "log"> {
  return {
    id: record.id,
    status,
    commit: record.commit,
    message: record.message,
    createdAt: record.createdAt,
    url: dashboardUrl(link),
  };
}

/** The variables of .env.production, or of .env on a machine where that is the production one. */
export function productionEnv(directory: string): Record<string, string> {
  for (const name of [".env.production", ".env"]) {
    const file = join(directory, name);
    if (existsSync(file)) return parseEnv(readFileSync(file, "utf8"));
  }
  throw new Error(".env.production does not exist. Run dstack production --domain example.com first.");
}

export const bunny: DeployProvider = {
  id: "bunny",
  name: "Bunny Magic Containers",
  auth: {
    kind: "token",
    env: "DSTACK_BUNNY_TOKEN",
    help: () =>
      "Copy the API key of your bunny.net account from https://dash.bunny.net/account/api-key. It also logs in to Bunny Container Registry.",
  },
  source: "local",
  target: {
    label: "Bunny API",
    placeholder: BUNNY_API,
    fixed: BUNNY_API,
    normalize: () => BUNNY_API,
  },
  platformEnv: BUNNY_PLATFORM_ENV,
  setupFlags: [
    { name: "region", description: "Bunny: the region of the app, such as DE (default: the closest)" },
    { name: "volumeSize", description: "Bunny: the size of the database volume in GB (default: 10)" },
    { name: "account", description: "Bunny: the account id, the namespace in Bunny Container Registry" },
  ],
  printsDns: true,
  connect: (_target, token) => {
    if (!token) throw new Error("Bunny needs an API key.");
    return new BunnyClient(token);
  },
};

import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseEnv } from "./env";
import { envPorts } from "./ports";
import { DEFAULT_STACK, decodePreset, type Stack } from "./stack";

/** The `.env` of `dstack run` on a development machine: the prod profile at https://site.localhost. */
export const RUN_ENV = ".env.run";
export const RUN_DOMAIN = "site.localhost";

/**
 * A project created by `init`, a directory with `compose.yaml` and `.env`,
 * as one Compose project: the one `.env` describes, or the local production
 * run of a development project (`.env.run`, its own containers and volumes).
 */
export interface Project {
  directory: string;
  /** The Compose project name from `compose.yaml`. */
  name: string;
  env: Record<string, string>;
  /** The Compose profiles from `COMPOSE_PROFILES`. */
  profiles: string[];
  /** Whether it runs the prod profile. */
  prod: boolean;
  /** Whether this is the local production run of a development project. */
  localRun: boolean;
  /** The Compose service names of this profile. */
  services: { backend: string; frontend: string; worker: string };
  /** Arguments before the `docker compose` subcommand. */
  composeArgs: string[];
  /** Extra environment for `docker compose`. */
  composeEnv: Record<string, string>;
}

/**
 * The project's scripts that must be executable. npm and pnpm packages do
 * not keep the executable bit of non-bin files, so the templates arrive
 * without it.
 */
export const EXECUTABLES = ["backend/entrypoint.sh", "backend/manage.py"];

/** Makes the project's scripts executable for everyone who can read them. */
export function makeExecutable(directory: string) {
  for (const file of EXECUTABLES) {
    const path = join(directory, file);
    try {
      const { mode } = statSync(path);
      const executable = mode | ((mode & 0o444) >> 2);
      if (executable !== mode) chmodSync(path, executable & 0o7777);
    } catch {}
  }
}

/** The project directory: `start` or the nearest parent with `compose.yaml` and `.env`. */
export function findProjectDirectory(start: string): string | undefined {
  let directory = resolve(start);
  for (;;) {
    if (existsSync(join(directory, "compose.yaml")) && existsSync(join(directory, ".env"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function parseProfiles(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((profile) => profile.trim())
    .filter(Boolean);
}

function projectName(directory: string): string {
  try {
    const match = readFileSync(join(directory, "compose.yaml"), "utf8").match(/^name:\s*["']?([\w.-]+)/m);
    if (match?.[1]) return match[1];
  } catch {}
  return basename(directory).toLowerCase();
}

function fromEnv(directory: string, name: string, envFile: string, localRun: boolean): Project {
  const env = parseEnv(readFileSync(join(directory, envFile), "utf8"));
  const profiles = parseProfiles(env.COMPOSE_PROFILES);
  const prod = profiles.includes("prod");
  const suffix = prod ? "-prod" : "";
  return {
    directory,
    name: localRun ? `${name}-run` : name,
    env,
    profiles,
    prod,
    localRun,
    services: { backend: `backend${suffix}`, frontend: `frontend${suffix}`, worker: `worker${suffix}` },
    composeArgs: localRun ? ["--env-file", envFile, "--project-name", `${name}-run`] : [],
    // compose.yaml reads the containers' variables from ${ENV_FILE:-.env}.
    composeEnv: localRun ? { ENV_FILE: envFile, COMPOSE_PROFILES: env.COMPOSE_PROFILES ?? "" } : {},
  };
}

/** Reads the project in or above `start`. Throws with a one-line reason when there is none. */
export function readProject(start = "."): Project {
  const directory = findProjectDirectory(start);
  if (!directory)
    throw new Error(`No DjangoStack project in ${resolve(start)}: run this where compose.yaml and .env are.`);
  // Repairs projects created by a CLI that copied the scripts without the executable bit.
  makeExecutable(directory);
  return fromEnv(directory, projectName(directory), ".env", false);
}

/** The local production run of a development project, when `.env.run` exists. */
export function readLocalRun(project: Project): Project | undefined {
  if (project.prod || project.localRun || !existsSync(join(project.directory, RUN_ENV))) return undefined;
  return fromEnv(project.directory, projectName(project.directory), RUN_ENV, true);
}

/** The `django-stack` section of the project's `package.json`. */
export function projectManifest(project: Project): { version?: string; frontend?: string; preset?: string } {
  try {
    const manifest = JSON.parse(readFileSync(join(project.directory, "package.json"), "utf8"));
    return manifest["django-stack"] ?? {};
  } catch {
    return {};
  }
}

/**
 * The project's stack: from the preset `init` saved in `package.json`, or,
 * for projects from before that, the defaults with the storage from `.env`.
 * Analytics follow the `analytics` profile: projects from before Umami was
 * generated have the default in their preset without running it.
 */
export function projectStack(project: Project): Stack {
  const analytics: Stack["analytics"] = project.profiles.includes("analytics") ? "umami" : "off";
  const fromEnv = {
    analytics,
    ...(project.env.CACHE_URL === undefined ? {} : cacheStack(project.env)),
    ...notificationsStack(project),
  };
  const { preset } = projectManifest(project);
  if (preset) {
    try {
      return { ...decodePreset(preset), ...fromEnv };
    } catch {}
  }
  return { ...DEFAULT_STACK, ...fromEnv, storage: project.profiles.includes("s3") ? "s3" : "local" };
}

/** Notifications are on when the backend's INSTALLED_APPS has Content Studio's notifications app. */
function notificationsStack(project: Project): Partial<Pick<Stack, "notifications">> {
  const settings = join(project.directory, "backend", "config", "settings.py");
  if (!existsSync(settings)) return {};
  return {
    notifications: /^ *["']content_studio\.notifications["'],/m.test(readFileSync(settings, "utf8"))
      ? "on"
      : "off",
  };
}

const REDIS = /^(redis|rediss|valkey|valkeys):/;

/**
 * The cache and the tasks a project's `.env` runs. Projects from before 0.7
 * have no TASKS_URL: their tasks follow a Redis cache, like the backend does.
 */
export function cacheStack(env: Record<string, string>): Pick<Stack, "cache" | "tasks"> {
  const cacheUrl = env.CACHE_URL ?? "";
  const cache = cacheUrl.startsWith("db:") ? "database" : REDIS.test(cacheUrl) ? "valkey" : "off";
  const tasksUrl = env.TASKS_URL || (cache === "valkey" ? cacheUrl : "immediate://");
  if (tasksUrl.startsWith("immediate:")) return { cache, tasks: "off" };
  return { cache, tasks: REDIS.test(tasksUrl) && cache !== "valkey" ? "huey-valkey" : "huey" };
}

/** The URLs of a running project. */
export function projectUrls(project: Project): { label: string; url: string }[] {
  if (project.prod) {
    const site = (project.env.SITE_URL ?? "").replace(/\/$/, "");
    return [
      { label: "Site", url: `${site}/` },
      { label: "Admin", url: `${site}/admin/` },
    ];
  }
  const ports = envPorts(project.env);
  const site = (project.env.SITE_URL || `http://localhost:${ports.SITE_PORT}`).replace(/\/$/, "");
  const urls = [
    { label: "Site", url: site },
    { label: "Admin", url: `${site}/admin/` },
    { label: "Mail", url: `http://localhost:${ports.MAIL_PORT}` },
  ];
  if (project.profiles.includes("s3")) urls.push({ label: "S3", url: `http://localhost:${ports.S3_PORT}` });
  return urls;
}

export type Runner = (cmd: string, args: string[], options: SpawnSyncOptions) => number;

/** Runs a command with the terminal attached and returns its exit status. */
export const runInherit: Runner = (cmd, args, options) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.error) return 127;
  return result.status ?? 1;
};

/** The full `docker compose` argument list for a project. */
export function composeCommand(project: Project, args: string[]): string[] {
  return ["compose", ...project.composeArgs, ...args];
}

export function composeOptions(project: Project): SpawnSyncOptions {
  return { cwd: project.directory, env: { ...process.env, ...project.composeEnv } };
}

/** Runs `docker compose <args>` for the project with the terminal attached. */
export function compose(project: Project, args: string[], run: Runner = runInherit): number {
  return run("docker", composeCommand(project, args), composeOptions(project));
}

/** Runs `docker compose <args>` and captures the output. */
export function composeOutput(project: Project, args: string[]): { status: number; output: string } {
  const result = spawnSync("docker", composeCommand(project, args), {
    ...composeOptions(project),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

/** The running services of the project. */
export function runningServices(project: Project): string[] {
  const result = spawnSync(
    "docker",
    composeCommand(project, ["ps", "--services", "--filter", "status=running"]),
    {
      ...composeOptions(project),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean) : [];
}

/**
 * The project a command acts on: the local production run when it is the
 * one running, otherwise the project `.env` describes.
 */
export function activeProject(project: Project): Project {
  const localRun = readLocalRun(project);
  if (!localRun) return project;
  if (runningServices(project).length) return project;
  return runningServices(localRun).length ? localRun : project;
}

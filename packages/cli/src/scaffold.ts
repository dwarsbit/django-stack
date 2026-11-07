import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, setEnvValues } from "./env";
import { portValues } from "./ports";
import { makeExecutable } from "./project";
import { generateProjectSecrets } from "./secrets";
import { DEFAULT_STACK, encodePreset, type Stack, stackOption, taskQueue } from "./stack";
import { CLI_VERSION } from "./version";

/** A frontend option; its template is `templates/frontend-<name>`. */
export type Frontend = Stack["frontend"];

/** `template.json` of a frontend template: its name and links. */
interface FrontendTemplate {
  label: string;
  url: string;
  /** Where to report security problems in the framework. */
  security: string;
}

/** The frontends this version of the CLI generates. */
export const FRONTENDS: readonly Frontend[] = stackOption("frontend")
  .values.filter((value) => value.generated)
  .map((value) => value.value as Frontend);

export interface ScaffoldOptions {
  /** The directory to create the project in. */
  directory: string;
  /** The project name: lowercase letters, digits and dashes. */
  name: string;
  frontend: Frontend;
  /** Demo pages and posts on the first start. */
  demoContent: boolean;
  /** An external Postgres URL; the bundled Postgres when not set. */
  databaseUrl?: string;
  /** The bundled Postgres's version, and the backend's Postgres client; stable by default. */
  postgres?: Stack["postgres"];
  /** Store uploads in the local S3 service in development, like S3 in production. */
  localS3?: boolean;
  /** Page analytics with the bundled Umami (the `analytics` profile). */
  analytics?: boolean;
  /** Content Studio's notifications app; on by default. */
  notifications?: boolean;
  /** The captcha of the contact form; on by default. */
  captcha?: boolean;
  /** The frontend's package manager; pnpm by default. */
  packageManager?: PackageManager;
  /** How errors are reported in production; by email by default. */
  errors?: Stack["errors"];
  /** The cache backend; the database by default. */
  cache?: Stack["cache"];
  /** The task queue; Huey where the cache is by default. */
  tasks?: Stack["tasks"];
  /** A DjangoStack monorepo to take the packages from instead of the registries (for development). */
  link?: string;
  /** The time zone of the backend, such as Europe/Amsterdam. UTC by default. */
  timeZone?: string;
  /** The development ports by `.env` variable, such as SITE_PORT; the usual ones when not set. */
  ports?: Record<string, number>;
  /** The preset code of the stack, saved in package.json for `config`. */
  preset?: string;
  /** Where the templates are; the ones in the package by default. */
  templatesDir?: string;
}

/** The Postgres major version of each `--postgres` value. */
export const POSTGRES_VERSIONS: Record<Stack["postgres"], string> = { stable: "17", latest: "18" };

/**
 * The template values of a Postgres version. From 18 the image keeps its data
 * in a versioned directory under /var/lib/postgresql, so the volume is
 * mounted there; before 18 at /var/lib/postgresql/data.
 */
export function postgresValues(postgres: Stack["postgres"]): Record<string, string> {
  const version = POSTGRES_VERSIONS[postgres];
  return {
    postgres_version: version,
    postgres_data: Number(version) >= 18 ? "/var/lib/postgresql" : "/var/lib/postgresql/data",
  };
}

/** A package manager of the frontend. */
export type PackageManager = Stack["packageManager"];

/** The pnpm and Bun versions the frontend image installs with. */
export const PNPM_VERSION = "12.18.0";
export const BUN_VERSION = "1.4.4";

const LOCKFILES: Record<PackageManager, string> = {
  pnpm: "pnpm-lock.yaml",
  npm: "package-lock.json",
  bun: "bun.lock",
};

/** The install command of a package manager: frozen to the lockfile when there is one. */
function installCommand(manager: PackageManager, flags = ""): string {
  const frozen = manager === "npm" ? "npm ci" : `${manager} install --frozen-lockfile`;
  return `if [ -f ${LOCKFILES[manager]} ]; then ${frozen}${flags}; else ${manager} install${flags}; fi`;
}

/**
 * The template values for a package manager: the commands in the README and
 * AGENTS.md, and the install steps of the frontend's Dockerfile. Scripts run
 * with npm in the image whatever installed them; it comes with Node.js.
 */
export function packageManagerValues(manager: PackageManager): Record<string, string> {
  return {
    package_manager: manager,
    pm_run: { pnpm: "pnpm", npm: "npm run", bun: "bun run" }[manager],
    // A manage.py command through the backend script; npm needs -- before its arguments.
    pm_backend: { pnpm: "pnpm backend", npm: "npm run backend --", bun: "bun run backend" }[manager],
    pm_setup: {
      pnpm: `RUN npm install --global pnpm@${PNPM_VERSION}`,
      npm: "# npm comes with Node.js.",
      bun: `COPY --from=oven/bun:${BUN_VERSION}-alpine /usr/local/bin/bun /usr/local/bin/bun`,
    }[manager],
    pm_manifests: {
      pnpm: "package.json pnpm-lock.yaml* pnpm-workspace.yaml",
      npm: "package.json package-lock.json*",
      bun: "package.json bun.lock*",
    }[manager],
    pm_install: installCommand(manager),
    pm_install_no_scripts: installCommand(manager, " --ignore-scripts"),
    pm_prune: {
      pnpm: "pnpm prune --prod",
      npm: "npm prune --omit=dev",
      bun: "rm -rf node_modules && bun install --production",
    }[manager],
  };
}

export interface ScaffoldResult {
  directory: string;
  adminUsername: string;
  adminPassword: string;
  files: number;
}

/** Umami's database URL: the project's database, with Umami's tables in the `umami` schema. */
export function umamiDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", "umami");
  return url.toString();
}

/** The `.env` values of the bundled Umami, from the project's database URL and secrets. */
export function umamiEnv(databaseUrl: string, secrets: Record<string, string>): Record<string, string> {
  return {
    UMAMI_URL: "http://umami:3000",
    UMAMI_WEBSITE_ID: randomUUID(),
    UMAMI_ADMIN_PASSWORD: secrets.umami_admin ?? "",
    UMAMI_APP_SECRET: secrets.umami_app ?? "",
    UMAMI_DATABASE_URL: umamiDatabaseUrl(databaseUrl),
  };
}

const CACHE_URLS: Record<Stack["cache"], string> = {
  database: "db://",
  valkey: "redis://cache:6379/0",
  off: "locmem://",
};

const TASK_ENV: Record<ReturnType<typeof taskQueue>, Record<string, string>> = {
  database: { TASKS_URL: "db://", TASK_WORKERS: "1" },
  valkey: { TASKS_URL: "redis://cache:6379/1", TASK_WORKERS: "1" },
  none: { TASKS_URL: "immediate://", TASK_WORKERS: "0" },
};

/** The `.env` values of a cache and a task queue: CACHE_URL, TASKS_URL and TASK_WORKERS. */
export function cacheEnv(stack: Pick<Stack, "cache" | "tasks">): Record<string, string> {
  return { CACHE_URL: CACHE_URLS[stack.cache], ...TASK_ENV[taskQueue(stack)] };
}

/** The line of Content Studio's notifications app in the backend's INSTALLED_APPS. */
const NOTIFICATIONS_APP = '    "content_studio.notifications",  # notifications in the admin and by email\n';
const NOTIFICATIONS_PATTERN = /^ *["']content_studio\.notifications["'],.*\n/m;

/**
 * Adds or removes Content Studio's notifications app in the text of
 * `backend/config/settings.py`. Throws when it can't find where it goes.
 */
export function setNotificationsApp(settingsText: string, on: boolean): string {
  const present = NOTIFICATIONS_PATTERN.test(settingsText);
  if (!on) return settingsText.replace(NOTIFICATIONS_PATTERN, "");
  if (present) return settingsText;
  // After Content Studio's other apps, as in a new project.
  const after = [
    /^ *["']content_studio\.contrib\.password_reset["'],.*\n/m,
    /^ *["']content_studio\.media_library["'],.*\n/m,
    /^ *["']content_studio["'],.*\n/m,
  ].find((pattern) => pattern.test(settingsText));
  if (!after)
    throw new Error(
      'backend/config/settings.py has no "content_studio" in INSTALLED_APPS; add "content_studio.notifications" there yourself.',
    );
  return settingsText.replace(after, (line) => line + NOTIFICATIONS_APP);
}

/** Whether `.env` values use the Valkey service (the `valkey` profile). */
export function usesValkey(env: Record<string, string | undefined>): boolean {
  return [env.CACHE_URL, env.TASKS_URL].some((url) =>
    /^(redis|rediss|valkey|valkeys):\/\/cache[:/]/.test(url ?? ""),
  );
}

/** The local S3 service of the `s3` profile, published on `port`. It accepts any credentials. */
export function localS3(port = 8333): Record<string, string> {
  return {
    S3_BUCKET: "media",
    S3_ENDPOINT_URL: "http://s3:8333",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "local",
    S3_SECRET_ACCESS_KEY: "local",
    S3_PUBLIC_URL: `http://localhost:${port}/media`,
    S3_CREATE_BUCKET: "1",
  };
}

export const LOCAL_S3: Record<string, string> = localS3();

const TEXT_EXTENSIONS =
  /\.(py|ts|tsx|mjs|js|jsx|json|astro|vue|svelte|css|md|yaml|yml|toml|txt|html|sh|svg)$|Dockerfile$|gitignore$|\.dockerignore$|env\.example$/;

export function defaultTemplatesDir(): string {
  return fileURLToPath(new URL("../templates", import.meta.url));
}

/** A valid project name from a directory name: `My Site` becomes `my-site`. */
export function toProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function validateProjectName(value: string): string | undefined {
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(value)) {
    return "Use lowercase letters, digits and dashes, starting with a letter.";
  }
  return undefined;
}

/** Postgres URLs for hosts other than this machine must use TLS. */
export function normalizeDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`The database URL is not a URL: ${url}`);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("The database URL must start with postgres:// or postgresql://.");
  }
  const local = ["localhost", "127.0.0.1", "host.docker.internal", "db"].includes(parsed.hostname);
  if (!local && !parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "require");
  return parsed.toString();
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function render(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => values[key] ?? match);
}

/** The IANA time zones Node knows, with UTC first. */
export function timeZones(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
}

export function validateTimeZone(value: string): string | undefined {
  if (timeZones().includes(value)) return undefined;
  return `${JSON.stringify(value)} is not a time zone. Use a name such as Europe/Amsterdam or UTC.`;
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const templates = options.templatesDir ?? defaultTemplatesDir();
  const target = options.directory;

  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} exists and is not empty. Choose another directory.`);
  }
  const nameError = validateProjectName(options.name);
  if (nameError)
    throw new Error(`The project name ${JSON.stringify(options.name)} is not valid. ${nameError}`);

  if (options.timeZone) {
    const zoneError = validateTimeZone(options.timeZone);
    if (zoneError) throw new Error(zoneError);
  }

  const frontendTemplate = join(templates, `frontend-${options.frontend}`);
  if (!existsSync(frontendTemplate)) {
    throw new Error(`This version of the CLI has no ${options.frontend} frontend.`);
  }

  mkdirSync(target, { recursive: true });
  cpSync(join(templates, "base"), target, { recursive: true });
  cpSync(join(templates, "backend"), join(target, "backend"), { recursive: true });
  cpSync(frontendTemplate, join(target, "frontend"), { recursive: true });
  renameSync(join(target, "gitignore"), join(target, ".gitignore"));
  makeExecutable(target);
  // The frontend's name and links, for the project's README, AGENTS.md and SECURITY.md.
  const about = join(target, "frontend", "template.json");
  const frontend = JSON.parse(readFileSync(about, "utf8")) as FrontendTemplate;
  rmSync(about);

  const packageManager = options.packageManager ?? "pnpm";
  const values = {
    project_name: options.name,
    frontend: options.frontend,
    frontend_label: frontend.label,
    frontend_url: frontend.url,
    frontend_security: frontend.security,
    cli_version: CLI_VERSION,
    preset: options.preset ?? encodePreset(DEFAULT_STACK),
    site_port: String(options.ports?.SITE_PORT ?? 3000),
    mail_port: String(options.ports?.MAIL_PORT ?? 8025),
    ...packageManagerValues(packageManager),
    ...postgresValues(options.postgres ?? DEFAULT_STACK.postgres),
  };
  const files = walk(target);
  for (const file of files) {
    if (!TEXT_EXTENSIONS.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const rendered = render(text, values);
    if (rendered !== text) writeFileSync(file, rendered);
  }

  // pnpm's settings only for pnpm; the package manager in package.json.
  if (packageManager !== "pnpm") rmSync(join(target, "frontend", "pnpm-workspace.yaml"), { force: true });
  if (packageManager !== "npm") {
    const packageJson = join(target, "frontend", "package.json");
    const manifest = JSON.parse(readFileSync(packageJson, "utf8"));
    const version = packageManager === "pnpm" ? PNPM_VERSION : BUN_VERSION;
    writeFileSync(
      packageJson,
      `${JSON.stringify({ ...manifest, packageManager: `${packageManager}@${version}` }, null, 2)}\n`,
    );
  }

  if (options.notifications === false) {
    const settings = join(target, "backend", "config", "settings.py");
    writeFileSync(settings, setNotificationsApp(readFileSync(settings, "utf8"), false));
  }

  if (options.timeZone && options.timeZone !== "UTC") {
    const settings = join(target, "backend", "config", "settings.py");
    const text = readFileSync(settings, "utf8");
    writeFileSync(
      settings,
      text.replace('TIME_ZONE = "UTC"', `TIME_ZONE = ${JSON.stringify(options.timeZone)}`),
    );
  }

  // .env with fresh secrets; .env.example with the names only.
  const template = readFileSync(join(target, "env.example"), "utf8");
  const secrets = generateProjectSecrets();
  let env = template.replace(/\{\{secret:([a-z_]+)\}\}/g, (match, key: string) => secrets[key] ?? match);
  const envExample = template.replace(/\{\{secret:[a-z_]+\}\}/g, "");
  const profiles = ["dev"];
  if (options.databaseUrl) {
    env = setEnvValues(env, { DATABASE_URL: normalizeDatabaseUrl(options.databaseUrl) });
  } else {
    profiles.push("db");
  }
  if (options.localS3) {
    profiles.push("s3");
    env = setEnvValues(env, LOCAL_S3);
  }
  if (options.analytics) {
    profiles.push("analytics");
    env = setEnvValues(env, umamiEnv(parseEnv(env).DATABASE_URL ?? "", secrets));
  }
  const cache = cacheEnv({ cache: options.cache ?? "database", tasks: options.tasks ?? "huey" });
  env = setEnvValues(env, cache);
  if (usesValkey(cache)) profiles.push("valkey");
  env = setEnvValues(env, { COMPOSE_PROFILES: profiles.join(",") });
  if (options.ports) env = setEnvValues(env, portValues(parseEnv(env), options.ports));
  if (!options.demoContent) env = setEnvValues(env, { SEED_DEMO_CONTENT: "0" });
  if (options.errors && options.errors !== "email") env = setEnvValues(env, { ERRORS: options.errors });
  if (options.captcha === false) env = setEnvValues(env, { CAPTCHA: "off" });
  writeFileSync(join(target, ".env"), env, { mode: 0o600 });
  writeFileSync(join(target, ".env.example"), envExample);
  rmSync(join(target, "env.example"));

  if (options.link) linkPackages(target, options.link);

  return {
    directory: target,
    adminUsername: "admin",
    adminPassword: secrets.admin ?? "",
    files: walk(target).length,
  };
}

/**
 * Development only: build django-stack and the @django-stack packages from a
 * monorepo checkout into the project's vendor/ directories and point the
 * dependencies at them, so a project can run before a release.
 */
export function linkPackages(target: string, monorepo: string) {
  const backendVendor = join(target, "backend", "vendor");
  const frontendVendor = join(target, "frontend", "vendor");
  mkdirSync(backendVendor, { recursive: true });
  mkdirSync(frontendVendor, { recursive: true });

  execFileSync("uv", ["build", "--wheel", "--out-dir", backendVendor], {
    cwd: join(monorepo, "python", "django-stack"),
    stdio: "ignore",
  });
  // uv writes a .gitignore that ignores everything in the output directory.
  rmSync(join(backendVendor, ".gitignore"), { force: true });
  const wheel = readdirSync(backendVendor).find((file) => file.endsWith(".whl"));
  if (!wheel) throw new Error("Building the django-stack wheel failed.");
  const pyproject = join(target, "backend", "pyproject.toml");
  writeFileSync(
    pyproject,
    `${readFileSync(pyproject, "utf8").trimEnd()}\n\n[tool.uv.sources]\ndjango-stack = { path = "vendor/${wheel}" }\n`,
  );

  // Every @django-stack package the frontend depends on, such as utils and svelte.
  const packageJson = join(target, "frontend", "package.json");
  const manifest = JSON.parse(readFileSync(packageJson, "utf8"));
  const packages = Object.keys(manifest.dependencies ?? {}).filter((name) =>
    name.startsWith("@django-stack/"),
  );
  for (const name of packages) {
    const directory = join(monorepo, "packages", name.slice("@django-stack/".length));
    execFileSync("pnpm", ["--filter", name, "build"], { cwd: monorepo, stdio: "ignore" });
    const before = new Set(readdirSync(frontendVendor));
    execFileSync("pnpm", ["pack", "--pack-destination", frontendVendor], { cwd: directory, stdio: "ignore" });
    const tarball = readdirSync(frontendVendor).find((file) => file.endsWith(".tgz") && !before.has(file));
    if (!tarball) throw new Error(`Packing ${name} failed.`);
    manifest.dependencies[name] = `file:vendor/${tarball}`;
  }
  writeFileSync(packageJson, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Locks the backend's dependencies with uv, when uv is installed. */
/** Runs a package manager in the frontend directory: pnpm and Bun through npx, at the image's version. */
function runPackageManager(directory: string, manager: PackageManager, args: string[]): boolean {
  const version = manager === "pnpm" ? PNPM_VERSION : BUN_VERSION;
  const [file, commandArgs] =
    manager === "npm" ? ["npm", args] : ["npx", ["--yes", `${manager}@${version}`, ...args]];
  try {
    execFileSync(file, commandArgs, {
      cwd: directory,
      stdio: "ignore",
      // npm and npx are .cmd scripts on Windows; the arguments are fixed.
      shell: process.platform === "win32",
    });
    return true;
  } catch {
    return false;
  }
}

/** Writes the frontend's lockfile with the chosen package manager, without installing anything. */
export function lockFrontend(target: string, manager: PackageManager): boolean {
  const directory = join(target, "frontend");
  const args =
    manager === "npm"
      ? ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]
      : ["install", "--lockfile-only"];
  return runPackageManager(directory, manager, args) && existsSync(join(directory, LOCKFILES[manager]));
}

/** The package manager of a project's frontend, from its lockfile. */
export function frontendPackageManager(directory: string): PackageManager | undefined {
  return (Object.keys(LOCKFILES) as PackageManager[]).find((manager) =>
    existsSync(join(directory, "frontend", LOCKFILES[manager])),
  );
}

/**
 * Updates the frontend's lockfile, without installing: the @django-stack
 * packages, or every package with `all`, within the ranges of package.json.
 * Returns the lockfile, or undefined without one or on failure.
 */
export function updateFrontendLock(target: string, all = false): string | undefined {
  const manager = frontendPackageManager(target);
  if (!manager) return undefined;
  const directory = join(target, "frontend");
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const names = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@django-stack/"));
  const packages = all ? [] : names;
  const args = {
    pnpm: ["update", ...packages, "--lockfile-only"],
    npm: ["update", ...packages, "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    bun: ["update", ...packages, "--lockfile-only"],
  }[manager];
  if (!all && !names.length) return LOCKFILES[manager];
  return runPackageManager(directory, manager, args) ? LOCKFILES[manager] : undefined;
}

export function lockBackend(target: string): boolean {
  try {
    execFileSync("uv", ["lock", "--quiet"], { cwd: join(target, "backend"), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function relativeDirectory(directory: string): string {
  const path = relative(process.cwd(), directory) || ".";
  return path.startsWith("..") ? directory : path;
}

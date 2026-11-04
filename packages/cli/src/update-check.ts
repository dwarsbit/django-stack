import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PACKAGE_NAME = "@django-stack/cli";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const DAY = 24 * 60 * 60 * 1000;

export interface UpdateCheckOptions {
  current: string;
  /** Where the last result is cached; see {@link defaultCachePath}. */
  cachePath?: string;
  /** How long a cached result stays valid, in milliseconds. One day by default. */
  maxAge?: number;
  /** How long to wait for the registry, in milliseconds. */
  timeout?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Cache {
  checkedAt: number;
  latest: string;
}

/** `$XDG_CACHE_HOME/django-stack/update-check.json`, or under `~/.cache`. */
export function defaultCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.XDG_CACHE_HOME || (process.platform === "win32" && env.LOCALAPPDATA) || join(homedir(), ".cache");
  return join(base, "django-stack", "update-check.json");
}

/** Whether to check at all: never in CI, without a terminal, or when turned off. */
export function updateCheckEnabled(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = Boolean(process.stdout.isTTY),
) {
  if (!isTTY) return false;
  if (env.CI && env.CI !== "0" && env.CI !== "false") return false;
  for (const key of ["DJANGO_STACK_NO_UPDATE_CHECK", "NO_UPDATE_NOTIFIER"]) {
    if (env[key] && env[key] !== "0") return false;
  }
  return true;
}

function parse(version: string): [number, number, number, string] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
}

/** Whether `latest` is a newer version than `current`. Prereleases of `latest` never count. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b || a[3]) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  // 1.0.0 is newer than 1.0.0-beta.1.
  return b[3] !== "";
}

function readCache(path: string): Cache | undefined {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data.checkedAt === "number" && typeof data.latest === "string") return data;
  } catch {}
  return undefined;
}

function writeCache(path: string, cache: Cache) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
  } catch {}
}

/**
 * The latest version on npm when it is newer than `current`, otherwise
 * undefined. Uses a cached result for a day; never throws.
 */
export async function checkForUpdate(options: UpdateCheckOptions): Promise<string | undefined> {
  const cachePath = options.cachePath ?? defaultCachePath();
  const now = options.now ?? Date.now;
  const maxAge = options.maxAge ?? DAY;
  let latest = readCache(cachePath);
  if (!latest || now() - latest.checkedAt > maxAge || latest.checkedAt > now()) {
    try {
      const response = await (options.fetch ?? fetch)(REGISTRY_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(options.timeout ?? 1500),
      });
      if (!response.ok) return undefined;
      const { version } = (await response.json()) as { version?: unknown };
      if (typeof version !== "string") return undefined;
      latest = { checkedAt: now(), latest: version };
      writeCache(cachePath, latest);
    } catch {
      return undefined;
    }
  }
  return isNewer(latest.latest, options.current) ? latest.latest : undefined;
}

/** The command that runs or installs the latest version, depending on how this one was started. */
export function updateCommand(
  location: string = import.meta.url,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = decodeURIComponent(location).replaceAll("\\", "/");
  if (path.includes("/_npx/")) return `npx ${PACKAGE_NAME}@latest`;
  if (path.includes("/dlx/") || path.includes("/dlx-")) return `pnpm dlx ${PACKAGE_NAME}@latest`;
  if (path.includes("/pnpm/global/")) return `pnpm add -g ${PACKAGE_NAME}@latest`;
  if (env.npm_config_user_agent?.startsWith("pnpm")) return `pnpm add -g ${PACKAGE_NAME}@latest`;
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

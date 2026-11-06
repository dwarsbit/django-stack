import { parseEnv, setEnvValues } from "./env";
import { envPorts } from "./ports";
import { cacheEnv, LOCAL_S3, localS3, umamiEnv, usesValkey } from "./scaffold";
import { generateProjectSecrets } from "./secrets";
import { STACK_OPTIONS, type Stack, type StackKey, type StackValue } from "./stack";

/** The options `config` can switch in an existing project. The rest follow with code generation. */
export const SWITCHABLE: readonly StackKey[] = ["storage", "analytics", "media", "cache", "tasks"];

export interface ConfigChange {
  /** The new `.env` text. */
  env: string;
  /** What changed, one line each. */
  changes: string[];
}

const EMPTY_S3 = Object.fromEntries(
  Object.keys(LOCAL_S3).map((key) => [key, key === "S3_CREATE_BUCKET" ? "0" : ""]),
);

/**
 * Applies a new stack to a project's `.env`. Throws with a one-line reason
 * for a change this version cannot make.
 */
export function applyStack(
  envText: string,
  env: Record<string, string>,
  from: Stack,
  to: Stack,
): ConfigChange {
  let text = envText;
  const changes: string[] = [];
  let profiles = (env.COMPOSE_PROFILES ?? "")
    .split(",")
    .map((profile) => profile.trim())
    .filter(Boolean);
  for (const option of STACK_OPTIONS) {
    const key = option.key as StackKey;
    if (from[key] === to[key]) continue;
    const value = (option.values as readonly StackValue[]).find((candidate) => candidate.value === to[key]);
    if (!value) throw new Error(`${JSON.stringify(to[key])} is not a ${option.key}.`);
    if (!SWITCHABLE.includes(key) || !value.generated)
      throw new Error(`${option.flag} ${to[key]} can't be set on an existing project in this version yet.`);
    if (key === "storage") {
      if (profiles.includes("prod"))
        throw new Error("--storage only changes development; this .env runs the prod profile.");
      const endpoint = env.S3_ENDPOINT_URL ?? "";
      if (endpoint && !endpoint.includes("s3:8333"))
        throw new Error(`S3_ENDPOINT_URL points at ${endpoint}; change the S3_* values in .env yourself.`);
      profiles = profiles.filter((profile) => profile !== "s3");
      if (to.storage === "s3") profiles.push("s3");
      text = setEnvValues(text, {
        ...(to.storage === "s3" ? localS3(envPorts(env).S3_PORT) : EMPTY_S3),
        COMPOSE_PROFILES: profiles.join(","),
      });
      changes.push(
        to.storage === "s3"
          ? "Uploads go to the local S3 service (the s3 profile)."
          : "Uploads go to a Docker volume; the local S3 service is off.",
      );
    }
    if (key === "cache") {
      text = setEnvValues(text, { CACHE_URL: cacheEnv(to).CACHE_URL ?? "" });
      changes.push(
        {
          database: "The cache is a table in the database.",
          valkey: "The cache is in Valkey (the valkey profile).",
          off: "The cache is per process; nothing is shared.",
        }[to.cache],
      );
    }
    if (key === "tasks" || (key === "cache" && from.tasks === "huey" && to.tasks === "huey")) {
      const { CACHE_URL: _, ...tasks } = cacheEnv(to);
      const before = parseEnv(text).TASKS_URL;
      text = setEnvValues(text, tasks);
      if (before !== tasks.TASKS_URL)
        changes.push(
          to.tasks === "off"
            ? "Tasks run in the request; the worker is off, so there are no daily backups."
            : `The worker keeps its task queue in ${tasks.TASKS_URL === "db://" ? "the database" : "Valkey"}.`,
        );
    }
    if (key === "cache" || key === "tasks") {
      profiles = profiles.filter((profile) => profile !== "valkey");
      if (usesValkey(parseEnv(text))) profiles.push("valkey");
      text = setEnvValues(text, { COMPOSE_PROFILES: profiles.join(",") });
    }
    if (key === "analytics") {
      profiles = profiles.filter((profile) => profile !== "analytics");
      if (to.analytics === "umami") {
        profiles.push("analytics");
        // Keep the website and secrets of an earlier Umami, so its numbers stay.
        const fresh = umamiEnv(env.DATABASE_URL ?? "", generateProjectSecrets());
        const kept = Object.fromEntries(
          Object.entries(fresh).filter(([name]) => name === "UMAMI_URL" || !env[name]),
        );
        text = setEnvValues(text, { ...kept, COMPOSE_PROFILES: profiles.join(",") });
        changes.push("Page analytics with Umami are on (the analytics profile).");
      } else {
        text = setEnvValues(text, { UMAMI_URL: "", COMPOSE_PROFILES: profiles.join(",") });
        changes.push("Page analytics are off; Umami's data stays in the database.");
      }
    }
    if (key === "media") {
      // Only the preset changes: `dstack production` and `dstack settings` act on it.
      changes.push(
        to.media === "s3"
          ? "Uploads in production go to S3; dstack settings asks for the S3 settings."
          : "Uploads in production stay on the server.",
      );
    }
  }
  return { env: text, changes };
}

/** Sets the preset in the `django-stack` section of a project's `package.json` text. */
export function setManifestPreset(manifestText: string, preset: string): string {
  const manifest = JSON.parse(manifestText);
  manifest["django-stack"] = { ...(manifest["django-stack"] ?? {}), preset };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

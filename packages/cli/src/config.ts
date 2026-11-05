import { setEnvValues } from "./env";
import { LOCAL_S3 } from "./scaffold";
import { STACK_OPTIONS, type Stack, type StackKey, type StackValue } from "./stack";

/** The options `config` can switch in an existing project. The rest follow with code generation. */
export const SWITCHABLE: readonly StackKey[] = ["storage"];

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
  const profiles = (env.COMPOSE_PROFILES ?? "")
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
      const next = profiles.filter((profile) => profile !== "s3");
      if (to.storage === "s3") next.push("s3");
      text = setEnvValues(text, {
        ...(to.storage === "s3" ? LOCAL_S3 : EMPTY_S3),
        COMPOSE_PROFILES: next.join(","),
      });
      changes.push(
        to.storage === "s3"
          ? "Uploads go to the local S3 service (the s3 profile)."
          : "Uploads go to a Docker volume; the local S3 service is off.",
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

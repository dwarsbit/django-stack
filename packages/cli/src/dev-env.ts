import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "./env";
import { envPorts } from "./ports";
import { type Project, projectManifest, projectName, projectStack, readProject } from "./project";
import { developmentEnv } from "./scaffold";
import { generateProjectSecrets } from "./secrets";
import { DEFAULT_STACK, decodePreset, type Stack } from "./stack";

/** The project directory for `dstack env`: `start` or the nearest parent with `compose.yaml` and `.env.example`. */
export function findEnvProjectDirectory(start: string): string | undefined {
  let directory = resolve(start);
  for (;;) {
    if (existsSync(join(directory, "compose.yaml")) && existsSync(join(directory, ".env.example")))
      return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * The stack of a project without a `.env`, such as a fresh clone: from the
 * preset `init` saved in `package.json`, or the defaults.
 */
function manifestStack(directory: string): Stack {
  const { preset } = projectManifest({ directory } as Project);
  if (preset) {
    try {
      return decodePreset(preset);
    } catch {}
  }
  return DEFAULT_STACK;
}

export interface FreshEnv {
  text: string;
  adminUsername: string;
  adminPassword: string;
  /** Whether it replaces an existing `.env`. */
  replaces: boolean;
  /** The Compose project name, for its volumes. */
  name: string;
}

/**
 * A new development `.env` for a project, the way `init` writes one: the
 * names of `.env.example` with fresh secrets and the project's stack. With
 * a `.env`, its stack, ports, PRODUCTION_DATABASE_URL and demo content stay;
 * without one, the stack comes from the preset in `package.json`.
 */
export function freshDevelopmentEnv(directory: string, options: { demoContent?: boolean } = {}): FreshEnv {
  const example = readFileSync(join(directory, ".env.example"), "utf8");
  const replaces = existsSync(join(directory, ".env"));
  const current = replaces ? readProject(directory) : undefined;
  const stack = current ? projectStack(current) : manifestStack(directory);
  const env = current?.env ?? {};
  const secrets = generateProjectSecrets();
  const text = developmentEnv(
    example,
    {
      headless: stack.frontend === "headless",
      demoContent: options.demoContent ?? env.SEED_DEMO_CONTENT !== "0",
      databaseUrl: env.PRODUCTION_DATABASE_URL || undefined,
      localS3: current ? current.profiles.includes("s3") : stack.storage === "s3",
      analytics: stack.analytics === "umami",
      cache: stack.cache,
      tasks: stack.tasks,
      errors: (env.ERRORS as Stack["errors"] | undefined) || stack.errors,
      captcha: stack.captcha === "on",
      ports: current ? envPorts(env) : undefined,
    },
    secrets,
  );
  return {
    text,
    adminUsername: parseEnv(text).ADMIN_USERNAME || "admin",
    adminPassword: parseEnv(text).ADMIN_PASSWORD ?? "",
    replaces,
    name: projectName(directory),
  };
}

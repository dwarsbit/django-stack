/**
 * The stack options of `init`: one table used by the prompts, the flags and
 * `--preset`. Each option is one character of a preset code, so the order of
 * STACK_OPTIONS and of every `values` list is append-only: never reorder or
 * remove an entry, or old preset codes change meaning. The first value is the
 * default.
 */

export interface StackValue {
  value: string;
  label: string;
  hint?: string;
  /** Whether this version of the CLI generates it. */
  generated: boolean;
}

export interface StackOption {
  key: string;
  /** The flag, such as `--cache`. */
  flag: string;
  /** The prompt's question. */
  message: string;
  description: string;
  values: readonly StackValue[];
}

export const STACK_OPTIONS = [
  {
    key: "frontend",
    flag: "--frontend",
    message: "Frontend",
    description: "The frontend framework",
    values: [
      { value: "astro", label: "Astro", hint: "server-rendered, fast by default", generated: true },
      { value: "next", label: "Next.js", hint: "React, server components", generated: false },
      { value: "headless", label: "Headless", hint: "just the API and the admin", generated: false },
      {
        value: "templates",
        label: "Django templates",
        hint: "no Node, Django renders the site",
        generated: false,
      },
      { value: "nuxt", label: "Nuxt", hint: "Vue, server-rendered", generated: true },
      { value: "sveltekit", label: "SvelteKit", hint: "Svelte, server-rendered", generated: false },
    ],
  },
  {
    key: "postgres",
    flag: "--postgres",
    message: "Postgres version",
    description: "The bundled Postgres version",
    values: [
      { value: "stable", label: "Stable", hint: "Postgres 17", generated: true },
      { value: "latest", label: "Latest", hint: "Postgres 18", generated: false },
    ],
  },
  {
    key: "analytics",
    flag: "--analytics",
    message: "Analytics",
    description: "Page analytics",
    values: [
      { value: "umami", label: "Umami", hint: "built in, private, no cookies", generated: false },
      { value: "off", label: "Off", generated: true },
    ],
  },
  {
    key: "tasks",
    flag: "--tasks",
    message: "Background tasks",
    description: "The task queue",
    values: [
      { value: "huey", label: "Huey", hint: "a worker container with Valkey", generated: true },
      { value: "off", label: "Off", generated: false },
    ],
  },
  {
    key: "cache",
    flag: "--cache",
    message: "Cache",
    description: "The cache backend",
    values: [
      {
        value: "database",
        label: "Database",
        hint: "a Postgres table, nothing extra to run",
        generated: false,
      },
      { value: "valkey", label: "Valkey", hint: "in memory, Redis-compatible", generated: false },
      { value: "off", label: "Off", generated: false },
    ],
  },
  {
    key: "notifications",
    flag: "--notifications",
    message: "Notifications",
    description: "Notifications in the admin and by email",
    values: [
      { value: "on", label: "On", hint: "in the admin and by email", generated: false },
      { value: "off", label: "Off", generated: true },
    ],
  },
  {
    key: "captcha",
    flag: "--captcha",
    message: "Captcha",
    description: "The built-in captcha for forms",
    values: [
      { value: "on", label: "On", hint: "proof of work, no tracking", generated: false },
      { value: "off", label: "Off", generated: true },
    ],
  },
  {
    key: "storage",
    flag: "--storage",
    message: "Uploads in development",
    description: "Where uploads go in development",
    values: [
      { value: "local", label: "Local files", hint: "a Docker volume", generated: true },
      { value: "s3", label: "Local S3", hint: "the same code path as S3 in production", generated: true },
    ],
  },
  {
    key: "packageManager",
    flag: "--package-manager",
    message: "Package manager",
    description: "The frontend's package manager",
    values: [
      { value: "pnpm", label: "pnpm", generated: false },
      { value: "npm", label: "npm", generated: true },
      { value: "bun", label: "Bun", generated: false },
    ],
  },
] as const satisfies readonly StackOption[];

type Options = (typeof STACK_OPTIONS)[number];
export type StackKey = Options["key"];
export type Stack = { [O in Options as O["key"]]: O["values"][number]["value"] };

export function stackOption(key: StackKey): StackOption {
  const option = STACK_OPTIONS.find((candidate) => candidate.key === key);
  if (!option) throw new Error(`Unknown stack option ${key}`);
  return option;
}

export function stackValues(key: StackKey): string[] {
  return stackOption(key).values.map((value) => value.value);
}

export const DEFAULT_STACK = Object.fromEntries(
  STACK_OPTIONS.map((option) => [option.key, option.values[0].value]),
) as Stack;

/** The frontends that run on Node, with a `frontend/` directory and a package manager. */
export const NODE_FRONTENDS: readonly string[] = ["astro", "next", "nuxt", "sveltekit"];

/** Whether an option applies to a stack: the package manager only with a Node frontend. */
export function applies(key: StackKey, stack: Partial<Stack>): boolean {
  if (key === "packageManager")
    return stack.frontend === undefined || NODE_FRONTENDS.includes(stack.frontend);
  return true;
}

/** The preset format version, the first character of a code. */
const VERSION = "a";
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A preset code for a stack: the version, then one character per option, trailing defaults left out. */
export function encodePreset(stack: Stack): string {
  const digits = STACK_OPTIONS.map((option) => {
    const index = (option.values as readonly StackValue[]).findIndex(
      (value) => value.value === stack[option.key as StackKey],
    );
    if (index < 0)
      throw new Error(`${JSON.stringify(stack[option.key as StackKey])} is not a ${option.key}.`);
    return DIGITS[index];
  })
    .join("")
    .replace(/0+$/, "");
  return VERSION + digits;
}

const UPGRADE = "This preset needs a newer CLI. Run npx @django-stack/cli@latest init.";

/** The stack of a preset code. Throws with a one-line reason for a bad code. */
export function decodePreset(code: string): Stack {
  if (!/^[0-9a-zA-Z]+$/.test(code)) throw new Error(`${JSON.stringify(code)} is not a preset.`);
  if (code[0] !== VERSION) {
    if (DIGITS.indexOf(code[0] ?? "") > DIGITS.indexOf(VERSION)) throw new Error(UPGRADE);
    throw new Error(`${JSON.stringify(code)} is not a preset.`);
  }
  const digits = code.slice(1);
  if (digits.length > STACK_OPTIONS.length) throw new Error(UPGRADE);
  const stack = { ...DEFAULT_STACK } as Record<string, string>;
  [...digits].forEach((digit, position) => {
    const option = STACK_OPTIONS[position] as StackOption;
    const value = option.values[DIGITS.indexOf(digit)];
    if (!value) throw new Error(UPGRADE);
    stack[option.key] = value.value;
  });
  return stack as Stack;
}

export const NAMED_PRESETS: Record<string, { description: string; stack: Partial<Stack> }> = {
  blog: { description: "Astro with everything on (the defaults)", stack: {} },
  api: {
    description: "Headless: the API and the admin, no analytics",
    stack: { frontend: "headless", analytics: "off" },
  },
  minimal: {
    description: "Astro with every optional service off",
    stack: { analytics: "off", tasks: "off", cache: "off", notifications: "off", captcha: "off" },
  },
};

/** The stack of a preset name or code. */
export function resolvePreset(input: string): Stack {
  const named = NAMED_PRESETS[input];
  if (named) return { ...DEFAULT_STACK, ...named.stack };
  return decodePreset(input);
}

/** The choices this CLI version does not generate yet, as `--flag value`. */
export function pendingChoices(stack: Stack): { key: StackKey; choice: string; isDefault: boolean }[] {
  return STACK_OPTIONS.flatMap((option) => {
    const key = option.key as StackKey;
    if (!applies(key, stack)) return [];
    const value = (option.values as readonly StackValue[]).find(
      (candidate) => candidate.value === stack[key],
    );
    if (!value || value.generated) return [];
    return [{ key, choice: `${option.flag} ${value.value}`, isDefault: value === option.values[0] }];
  });
}

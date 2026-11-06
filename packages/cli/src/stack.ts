/**
 * The stack options of `init`: one table used by the prompts, the flags and
 * `--preset`. Each option is a field of `bits` bits in a preset code, in this
 * order, so the order of STACK_OPTIONS and of every `values` list is
 * append-only: never reorder or remove an entry, change `bits`, or add more
 * values than fit, or old preset codes change meaning. The first value is
 * the default.
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
  /** The width of its field in a preset code: room for 2^bits values. */
  bits: number;
  values: readonly StackValue[];
}

export const STACK_OPTIONS = [
  {
    key: "frontend",
    flag: "--frontend",
    message: "Frontend",
    description: "The frontend framework",
    bits: 4,
    values: [
      { value: "astro", label: "Astro", hint: "server-rendered, fast by default", generated: true },
      { value: "next", label: "Next.js", hint: "React, server components", generated: true },
      { value: "headless", label: "Headless", hint: "just the API and the admin", generated: false },
      {
        value: "templates",
        label: "Django templates",
        hint: "no Node, Django renders the site",
        generated: false,
      },
      { value: "nuxt", label: "Nuxt", hint: "Vue, server-rendered", generated: true },
      { value: "sveltekit", label: "SvelteKit", hint: "Svelte, server-rendered", generated: true },
    ],
  },
  {
    key: "postgres",
    flag: "--postgres",
    message: "Postgres version",
    description: "The bundled Postgres version",
    bits: 2,
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
    bits: 2,
    values: [
      { value: "umami", label: "Umami", hint: "built in, private, no cookies", generated: true },
      { value: "off", label: "Off", generated: true },
    ],
  },
  {
    key: "tasks",
    flag: "--tasks",
    message: "Background tasks",
    description: "The task queue",
    bits: 2,
    values: [
      {
        value: "huey",
        label: "Huey",
        hint: "a worker container, the queue where the cache is",
        generated: true,
      },
      { value: "off", label: "Off", hint: "tasks run in the request, no daily backups", generated: true },
      { value: "huey-valkey", label: "Huey on Valkey", hint: "the queue in Valkey", generated: true },
    ],
  },
  {
    key: "cache",
    flag: "--cache",
    message: "Cache",
    description: "The cache backend",
    bits: 3,
    values: [
      {
        value: "database",
        label: "Database",
        hint: "a Postgres table, nothing extra to run",
        generated: true,
      },
      { value: "valkey", label: "Valkey", hint: "in memory, Redis-compatible", generated: true },
      { value: "off", label: "Off", hint: "a cache per process", generated: true },
    ],
  },
  {
    key: "notifications",
    flag: "--notifications",
    message: "Notifications",
    description: "Notifications in the admin and by email",
    bits: 2,
    values: [
      { value: "on", label: "On", hint: "in the admin and by email", generated: true },
      { value: "off", label: "Off", generated: true },
    ],
  },
  {
    key: "captcha",
    flag: "--captcha",
    message: "Captcha",
    description: "The built-in captcha for forms",
    bits: 2,
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
    bits: 2,
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
    bits: 3,
    values: [
      { value: "pnpm", label: "pnpm", generated: false },
      { value: "npm", label: "npm", generated: true },
      { value: "bun", label: "Bun", generated: false },
    ],
  },
  {
    key: "media",
    flag: "--media",
    message: "Uploads in production",
    description: "Where uploads go in production",
    bits: 2,
    values: [
      {
        value: "server",
        label: "On the server",
        hint: "a Docker volume, backed up with the database",
        generated: true,
      },
      { value: "s3", label: "S3", hint: "any S3-compatible service; credentials later", generated: true },
    ],
  },
] as const satisfies readonly StackOption[];

type Options = (typeof STACK_OPTIONS)[number];
export type StackKey = Options["key"];
export type Stack = { [O in Options as O["key"]]: O["values"][number]["value"] };

/**
 * The order of the prompts. It differs from STACK_OPTIONS (the preset order,
 * append-only): the cache comes before the tasks, whose queue follows it,
 * and uploads in production before uploads in development.
 */
export const PROMPT_ORDER: readonly StackKey[] = (() => {
  const keys: StackKey[] = STACK_OPTIONS.map((option) => option.key as StackKey).filter(
    (key) => key !== "media" && key !== "cache",
  );
  keys.splice(keys.indexOf("storage"), 0, "media");
  keys.splice(keys.indexOf("tasks"), 0, "cache");
  return keys;
})();

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

/** Where the task queue of a stack is: the database, Valkey, or none (tasks run in the request). */
export function taskQueue(stack: Pick<Stack, "cache" | "tasks">): "database" | "valkey" | "none" {
  if (stack.tasks === "off") return "none";
  if (stack.tasks === "huey-valkey" || stack.cache === "valkey") return "valkey";
  return "database";
}

/** The frontends that run on Node, with a `frontend/` directory and a package manager. */
export const NODE_FRONTENDS: readonly string[] = ["astro", "next", "nuxt", "sveltekit"];

/** Whether an option applies to a stack: the package manager only with a Node frontend. */
export function applies(key: StackKey, stack: Partial<Stack>): boolean {
  if (key === "packageManager")
    return stack.frontend === undefined || NODE_FRONTENDS.includes(stack.frontend);
  return true;
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Preset codes are six characters: the format version, then the stack as
 * one number in five base62 digits. The options are bit fields of that
 * number, the first option in the lowest bits; the bits above the last
 * option are for options to come and must be 0.
 *
 * The number is multiplied by MULTIPLIER and offset by OFFSET (modulo
 * 62^5) before it is written, so codes look different from each other
 * rather than mostly zeros, and a mistyped code is usually refused instead
 * of meaning another stack. Both constants are part of the format: never
 * change them.
 */
const VERSION = "b";
/** The first format: one character per option, trailing defaults left out. */
const VERSION_A = "a";
const LENGTH = 5;
const MODULUS = 62n ** BigInt(LENGTH);
/** The bits a code can hold: 2^29 is below 62^5. */
const CAPACITY = 29;
const MULTIPLIER = 387_420_489n; // 3^18, coprime with 62^5
const OFFSET = 578_291_047n;

/** The inverse of `value` modulo `modulus`. */
function inverse(value: bigint, modulus: bigint): bigint {
  let [a, b, x, y] = [value % modulus, modulus, 1n, 0n];
  while (b) {
    const q = a / b;
    [a, b] = [b, a - q * b];
    [x, y] = [y, x - q * y];
  }
  return ((x % modulus) + modulus) % modulus;
}
const MULTIPLIER_INVERSE = inverse(MULTIPLIER, MODULUS);

/** A preset code for a stack: always six characters, such as `b8Kq2x`. */
export function encodePreset(stack: Stack): string {
  let number = 0n;
  let shift = 0n;
  for (const option of STACK_OPTIONS as readonly StackOption[]) {
    const index = option.values.findIndex((value) => value.value === stack[option.key as StackKey]);
    if (index < 0)
      throw new Error(`${JSON.stringify(stack[option.key as StackKey])} is not a ${option.key}.`);
    number |= BigInt(index) << shift;
    shift += BigInt(option.bits);
  }
  let scrambled = (number * MULTIPLIER + OFFSET) % MODULUS;
  let digits = "";
  for (let position = 0; position < LENGTH; position++) {
    digits = DIGITS[Number(scrambled % 62n)] + digits;
    scrambled /= 62n;
  }
  return VERSION + digits;
}

const UPGRADE = "This preset needs a newer CLI. Run npx @django-stack/cli@latest init.";

function notAPreset(code: string): Error {
  return new Error(
    `${JSON.stringify(code)} is not a preset. Check the code, or run npx @django-stack/cli@latest init if it is from a newer CLI.`,
  );
}

/** The stack of a code in the first format, which `init` wrote before 0.7. */
function decodeVersionA(code: string): Stack {
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

/** The stack of a preset code. Throws with a one-line reason for a bad code. */
export function decodePreset(code: string): Stack {
  if (!/^[0-9a-zA-Z]+$/.test(code)) throw new Error(`${JSON.stringify(code)} is not a preset.`);
  if (code[0] === VERSION_A) return decodeVersionA(code);
  if (code[0] !== VERSION) {
    if (DIGITS.indexOf(code[0] ?? "") > DIGITS.indexOf(VERSION)) throw new Error(UPGRADE);
    throw new Error(`${JSON.stringify(code)} is not a preset.`);
  }
  if (code.length !== LENGTH + 1) throw notAPreset(code);
  let scrambled = 0n;
  for (const digit of code.slice(1)) scrambled = scrambled * 62n + BigInt(DIGITS.indexOf(digit));
  let number = (((scrambled - OFFSET) % MODULUS) + MODULUS) % MODULUS;
  number = (number * MULTIPLIER_INVERSE) % MODULUS;
  if (number >> BigInt(CAPACITY)) throw notAPreset(code);
  const stack = {} as Record<string, string>;
  for (const option of STACK_OPTIONS as readonly StackOption[]) {
    const index = Number(number & ((1n << BigInt(option.bits)) - 1n));
    number >>= BigInt(option.bits);
    const value = option.values[index];
    if (!value) throw notAPreset(code);
    stack[option.key] = value.value;
  }
  // Bits above the known options: options of a newer CLI, or a typo.
  if (number) throw notAPreset(code);
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

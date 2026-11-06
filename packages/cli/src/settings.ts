import { missingS3 } from "./production";

/**
 * The production settings that `init` and `production` cannot know: the
 * credentials of outside services and your own addresses. `dstack settings`
 * asks for the ones that are missing, group by group.
 */

export interface SettingField {
  /** The `.env` variable, or the name of a part that `values` combines. */
  name: string;
  message: string;
  placeholder?: string;
  /** Asked without echo, and its current value is never shown. */
  secret?: boolean;
  /** Empty is a valid answer. */
  optional?: boolean;
  /** The answer when none is given. */
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}

export interface SettingContext {
  /** The `media` stack option of the project. */
  media?: string;
}

export interface SettingGroup {
  title: string;
  /** The `.env` variables it sets; `--set` takes these. */
  names: string[];
  /** Whether the group applies to this project at all. */
  applies: (env: Record<string, string>, context: SettingContext) => boolean;
  /** The variables that are missing or a placeholder. */
  missing: (env: Record<string, string>) => string[];
  fields: SettingField[];
  /** The current answer of a field, from the `.env`. */
  current?: (env: Record<string, string>, field: string) => string | undefined;
  /** The `.env` values from the answers, by field name. */
  values: (answers: Record<string, string>) => Record<string, string>;
}

export function validateEmail(value: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? undefined
    : "Enter an email address, such as you@example.com.";
}

function validateHost(value: string): string | undefined {
  return /^[a-z0-9.-]+$/i.test(value) && value.includes(".")
    ? undefined
    : "Enter a host name, such as smtp.example.com.";
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? undefined : "Enter a port, such as 587.";
}

function validateUrl(value: string): string | undefined {
  if (!value) return undefined;
  return /^https?:\/\/[^\s/]+/.test(value) ? undefined : "Enter a URL that starts with https://.";
}

const required = (label: string) => (value: string) => (value.trim() ? undefined : `Enter the ${label}.`);

/**
 * An SMTP URL for EMAIL_URL: smtps:// on port 465, smtp:// on 25, otherwise
 * smtp+tls:// (STARTTLS), with the user name and password URL-encoded.
 */
export function smtpUrl(parts: { host: string; port: string; username?: string; password?: string }): string {
  const port = Number(parts.port || "587");
  const scheme = port === 465 ? "smtps" : port === 25 ? "smtp" : "smtp+tls";
  const user = parts.username ? encodeURIComponent(parts.username) : "";
  const password = parts.password ? `:${encodeURIComponent(parts.password)}` : "";
  return `${scheme}://${user ? `${user}${password}@` : ""}${parts.host}:${port}`;
}

/** The parts of an SMTP URL, for the current answers. */
function smtpParts(value: string | undefined): Record<string, string> {
  try {
    const url = new URL(value ?? "");
    return {
      host: url.hostname,
      port: url.port,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return {};
  }
}

const placeholderMail = (value: string | undefined) =>
  !value || value.includes("mailpit") || value.includes("example.com") || value.startsWith("console:");

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    title: "Admin email",
    names: ["ADMIN_EMAIL"],
    applies: () => true,
    missing: (env) => (!env.ADMIN_EMAIL || env.ADMIN_EMAIL.endsWith("@example.com") ? ["ADMIN_EMAIL"] : []),
    fields: [
      {
        name: "ADMIN_EMAIL",
        message: "Your email address, for the admin user",
        placeholder: "you@example.com",
        validate: validateEmail,
      },
    ],
    values: (answers) => ({ ADMIN_EMAIL: answers.ADMIN_EMAIL ?? "" }),
  },
  {
    title: "Outgoing mail",
    names: ["EMAIL_URL"],
    applies: () => true,
    missing: (env) => (placeholderMail(env.EMAIL_URL) ? ["EMAIL_URL"] : []),
    fields: [
      { name: "host", message: "SMTP server", placeholder: "smtp.example.com", validate: validateHost },
      { name: "port", message: "SMTP port", defaultValue: "587", validate: validatePort },
      { name: "username", message: "SMTP user name", optional: true },
      { name: "password", message: "SMTP password", secret: true, optional: true },
    ],
    current: (env, field) => (placeholderMail(env.EMAIL_URL) ? undefined : smtpParts(env.EMAIL_URL)[field]),
    values: (answers) => ({
      EMAIL_URL: smtpUrl({
        host: answers.host ?? "",
        port: answers.port ?? "587",
        username: answers.username,
        password: answers.password,
      }),
    }),
  },
  {
    title: "S3 for uploads",
    names: [
      "S3_BUCKET",
      "S3_ENDPOINT_URL",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_PUBLIC_URL",
    ],
    applies: (env, context) => context.media === "s3" || Boolean(env.S3_BUCKET),
    missing: missingS3,
    fields: [
      { name: "S3_BUCKET", message: "S3 bucket", placeholder: "example-media", validate: required("bucket") },
      {
        name: "S3_ENDPOINT_URL",
        message: "S3 endpoint, empty for AWS",
        placeholder: "https://fsn1.your-objectstorage.com",
        optional: true,
        validate: validateUrl,
      },
      { name: "S3_REGION", message: "S3 region", placeholder: "eu-central-1", validate: required("region") },
      { name: "S3_ACCESS_KEY_ID", message: "S3 access key ID", validate: required("access key ID") },
      {
        name: "S3_SECRET_ACCESS_KEY",
        message: "S3 secret access key",
        secret: true,
        validate: required("secret access key"),
      },
      {
        name: "S3_PUBLIC_URL",
        message: "Public URL of the files, empty when it is the endpoint",
        placeholder: "https://media.example.com",
        optional: true,
        validate: validateUrl,
      },
    ],
    current: (env, field) => env[field],
    values: (answers) =>
      Object.fromEntries(
        [
          "S3_BUCKET",
          "S3_ENDPOINT_URL",
          "S3_REGION",
          "S3_ACCESS_KEY_ID",
          "S3_SECRET_ACCESS_KEY",
          "S3_PUBLIC_URL",
        ].map((name) => [name, answers[name] ?? ""]),
      ),
  },
];

/** The groups of a production `.env` to ask for: the missing ones, or with `all` every one that applies. */
export function settingsToAsk(
  env: Record<string, string>,
  context: SettingContext,
  all = false,
): SettingGroup[] {
  return SETTING_GROUPS.filter((group) => group.applies(env, context) && (all || group.missing(env).length));
}

/** Every `.env` variable `--set` takes. */
export const SETTING_NAMES: readonly string[] = SETTING_GROUPS.flatMap((group) => group.names);

/** Parses `--set NAME=value` arguments. Throws with a one-line reason. */
export function parseAssignments(items: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const item of items) {
    const index = item.indexOf("=");
    const name = index > 0 ? item.slice(0, index) : "";
    if (!SETTING_NAMES.includes(name))
      throw new Error(`${JSON.stringify(item)} is not NAME=value for one of ${SETTING_NAMES.join(", ")}.`);
    const value = item.slice(index + 1);
    if (/[\r\n]/.test(value)) throw new Error(`The value of ${name} has a line break.`);
    if (name === "ADMIN_EMAIL" && validateEmail(value))
      throw new Error(`ADMIN_EMAIL: ${validateEmail(value)}`);
    values[name] = value;
  }
  return values;
}

/** The items of `production`'s to-do list that the settings now in `env` have done. */
export function remainingTodo(todo: readonly string[], env: Record<string, string>): string[] {
  return todo.filter((item) => {
    const group = SETTING_GROUPS.find((candidate) =>
      candidate.names.some((name) => item.includes(name.startsWith("S3_") ? "S3_" : name)),
    );
    return !group || group.missing(env).length > 0;
  });
}

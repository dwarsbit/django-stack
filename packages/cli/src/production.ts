import { parseEnv, setEnvValues } from "./env";
import { normalizeDatabaseUrl, umamiDatabaseUrl } from "./scaffold";
import { generateProjectSecrets } from "./secrets";

export interface ProductionOptions {
  /** The domain the site runs on, such as example.com. */
  domain: string;
  /** The SMTP server for outgoing mail. */
  emailUrl?: string;
  /** Where uploads go: `s3` asks for the S3 settings (the `media` stack option). */
  media?: string;
  /** Keep the bundled database even with PRODUCTION_DATABASE_URL: the local run on this machine. */
  bundledDatabase?: boolean;
  /** An external Postgres for the server; it takes the place of PRODUCTION_DATABASE_URL. */
  databaseUrl?: string;
}

/**
 * A Postgres URL from its parts, with the user name, password and database
 * name URL-encoded, so a password with `@`, `:`, `/` or `#` still works.
 * Hosts other than this machine get `sslmode=require`.
 */
export function postgresUrl(parts: {
  host: string;
  port?: string;
  name: string;
  user: string;
  password?: string;
}): string {
  const host = parts.host.includes(":") && !parts.host.startsWith("[") ? `[${parts.host}]` : parts.host;
  const password = parts.password ? `:${encodeURIComponent(parts.password)}` : "";
  return normalizeDatabaseUrl(
    `postgres://${encodeURIComponent(parts.user)}${password}@${host}:${parts.port || "5432"}/${encodeURIComponent(parts.name)}`,
  );
}

export interface ProductionEnv {
  text: string;
  adminPassword: string;
  /** Things to finish by hand before the first deploy. */
  todo: string[];
}

/** The S3 settings that uploads to S3 need and that are empty. */
export function missingS3(env: Record<string, string>): string[] {
  return ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((name) => !env[name]);
}

export function validateDomain(domain: string): string | undefined {
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    return "Enter a domain name such as example.com, without https://.";
  }
  return undefined;
}

/**
 * The .env for a server, from a project's development .env: the prod
 * profile, HTTPS on the domain, and fresh secrets, so nothing from the
 * laptop works on the server.
 */
export function productionEnv(devEnv: string, options: ProductionOptions): ProductionEnv {
  const domainError = validateDomain(options.domain);
  if (domainError) throw new Error(domainError);
  const current = parseEnv(devEnv);
  const secrets = generateProjectSecrets();
  const url = `https://${options.domain.toLowerCase()}`;
  const todo: string[] = [];

  const profiles = (current.COMPOSE_PROFILES ?? "dev,db")
    .split(",")
    .map((profile) => profile.trim())
    .filter((profile) => profile && profile !== "dev" && profile !== "s3");
  profiles.unshift("prod");

  const values: Record<string, string> = {
    COMPOSE_PROFILES: [...new Set(profiles)].join(","),
    SITE_URL: url,
    BACKEND_URL: url,
    DJANGO_DEBUG: "0",
    DJANGO_SECRET_KEY: secrets.django ?? "",
    API_SECRET_KEY: secrets.api ?? "",
    API_READ_KEY: secrets.api_read ?? "",
    PREVIEW_SECRET: secrets.preview ?? "",
    REVALIDATE_SECRET: secrets.revalidate ?? "",
    ADMIN_PASSWORD: secrets.admin ?? "",
    DEFAULT_FROM_EMAIL: `${current.PROJECT_NAME ?? "site"} <noreply@${options.domain.toLowerCase()}>`,
  };

  // PRODUCTION_DATABASE_URL: the server's external Postgres instead of the
  // bundled one, which development keeps.
  const external = options.bundledDatabase
    ? ""
    : options.databaseUrl
      ? normalizeDatabaseUrl(options.databaseUrl)
      : current.PRODUCTION_DATABASE_URL
        ? normalizeDatabaseUrl(current.PRODUCTION_DATABASE_URL)
        : "";
  if (external) {
    values.DATABASE_URL = external;
    values.POSTGRES_PASSWORD = "";
    values.COMPOSE_PROFILES = [...new Set(profiles.filter((profile) => profile !== "db"))].join(",");
  } else if (profiles.includes("db")) {
    // The bundled database gets a new password.
    const user = current.POSTGRES_USER || "app";
    const name = current.POSTGRES_DB || "app";
    values.POSTGRES_PASSWORD = secrets.postgres ?? "";
    values.DATABASE_URL = `postgres://${user}:${secrets.postgres}@db:5432/${name}`;
  }

  // Umami gets new secrets; on the server's fresh database the backend sets
  // its admin password and creates the website again.
  if (current.UMAMI_URL) {
    values.UMAMI_ADMIN_PASSWORD = secrets.umami_admin ?? "";
    values.UMAMI_APP_SECRET = secrets.umami_app ?? "";
    values.UMAMI_DATABASE_URL = umamiDatabaseUrl(values.DATABASE_URL ?? current.DATABASE_URL ?? "");
  }

  if (options.emailUrl) {
    values.EMAIL_URL = options.emailUrl;
  } else if (!current.EMAIL_URL || current.EMAIL_URL.includes("mailpit")) {
    values.EMAIL_URL = "smtp+tls://user:password@smtp.example.com:587";
    todo.push("Set EMAIL_URL to your SMTP server, so password resets and notifications are sent.");
  }

  // The local S3 service only exists in development.
  if ((current.S3_ENDPOINT_URL ?? "").includes("s3:8333")) {
    Object.assign(values, {
      S3_BUCKET: "",
      S3_ENDPOINT_URL: "",
      S3_REGION: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      S3_PUBLIC_URL: "",
      S3_CREATE_BUCKET: "0",
    });
    if (options.media !== "s3")
      todo.push(
        "Set the S3_* variables to your S3 service, or leave them empty to keep uploads on the server.",
      );
  }
  if (options.media === "s3" && missingS3(parseEnv(setEnvValues(devEnv, values))).length)
    todo.push("Set the S3_* variables to your S3 service: uploads go to S3 in production.");
  if (!current.ADMIN_EMAIL || current.ADMIN_EMAIL.endsWith("@example.com")) {
    todo.push("Set ADMIN_EMAIL to your address.");
  }
  if (current.SEED_DEMO_CONTENT === "1") {
    todo.push("Set SEED_DEMO_CONTENT=0 unless the site should start with the demo pages and posts.");
  }

  return { text: setEnvValues(devEnv, values), adminPassword: values.ADMIN_PASSWORD ?? "", todo };
}

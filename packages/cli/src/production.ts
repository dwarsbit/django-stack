import { parseEnv, setEnvValues } from "./env";
import { generateProjectSecrets } from "./secrets";

export interface ProductionOptions {
  /** The domain the site runs on, such as example.com. */
  domain: string;
  /** The SMTP server for outgoing mail. */
  emailUrl?: string;
}

export interface ProductionEnv {
  text: string;
  adminPassword: string;
  /** Things to finish by hand before the first deploy. */
  todo: string[];
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

  // The bundled database gets a new password; an external one is kept.
  if (profiles.includes("db")) {
    const user = current.POSTGRES_USER || "app";
    const name = current.POSTGRES_DB || "app";
    values.POSTGRES_PASSWORD = secrets.postgres ?? "";
    values.DATABASE_URL = `postgres://${user}:${secrets.postgres}@db:5432/${name}`;
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
    todo.push(
      "Set the S3_* variables to your S3 service, or leave them empty to keep uploads on the server.",
    );
  }
  if (!current.ADMIN_EMAIL || current.ADMIN_EMAIL.endsWith("@example.com")) {
    todo.push("Set ADMIN_EMAIL to your address.");
  }
  if (current.SEED_DEMO_CONTENT === "1") {
    todo.push("Set SEED_DEMO_CONTENT=0 unless the site should start with the demo pages and posts.");
  }

  return { text: setEnvValues(devEnv, values), adminPassword: values.ADMIN_PASSWORD ?? "", todo };
}

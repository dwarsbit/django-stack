import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseEnv, productionEnv, scaffold, validateDomain } from "../src";
import { writePrivateFile } from "../src/env";
import { postgresUrl } from "../src/production";

const root = mkdtempSync(join(tmpdir(), "django-stack-prod-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function devEnv(options: { localS3?: boolean; databaseUrl?: string; analytics?: boolean } = {}) {
  const directory = join(root, `p${Math.random().toString(36).slice(2)}`);
  scaffold({ directory, name: "site", frontend: "astro", demoContent: true, ...options });
  return readFileSync(join(directory, ".env"), "utf8");
}

describe("productionEnv", () => {
  it("gives Umami new secrets and keeps its website", () => {
    const text = devEnv({ analytics: true });
    const dev = parseEnv(text);
    const prod = parseEnv(productionEnv(text, { domain: "example.com" }).text);
    expect(prod.COMPOSE_PROFILES).toBe("prod,db,analytics");
    expect(prod.UMAMI_WEBSITE_ID).toBe(dev.UMAMI_WEBSITE_ID);
    expect(prod.UMAMI_ADMIN_PASSWORD).not.toBe(dev.UMAMI_ADMIN_PASSWORD);
    expect(prod.UMAMI_APP_SECRET).not.toBe(dev.UMAMI_APP_SECRET);
    expect(prod.UMAMI_DATABASE_URL).toBe(`postgres://app:${prod.POSTGRES_PASSWORD}@db:5432/app?schema=umami`);
  });

  it("switches to the prod profile with new secrets", () => {
    const text = devEnv();
    const dev = parseEnv(text);
    const result = productionEnv(text, { domain: "Example.com" });
    const prod = parseEnv(result.text);
    expect(prod.COMPOSE_PROFILES).toBe("prod,db");
    expect(prod.SITE_URL).toBe("https://example.com");
    expect(prod.BACKEND_URL).toBe("https://example.com");
    expect(prod.DJANGO_DEBUG).toBe("0");
    for (const key of [
      "DJANGO_SECRET_KEY",
      "API_SECRET_KEY",
      "API_READ_KEY",
      "PREVIEW_SECRET",
      "POSTGRES_PASSWORD",
    ]) {
      expect(prod[key], key).not.toBe(dev[key]);
      expect(prod[key]?.length, key).toBeGreaterThan(20);
    }
    expect(prod.DATABASE_URL).toBe(`postgres://app:${prod.POSTGRES_PASSWORD}@db:5432/app`);
    expect(prod.ADMIN_PASSWORD).toBe(result.adminPassword);
    expect(prod.DEFAULT_FROM_EMAIL).toBe("site <noreply@example.com>");
    expect(result.todo.join(" ")).toContain("EMAIL_URL");
  });

  it("uses the external database and drops the bundled one and the local S3 service", () => {
    const text = devEnv({ databaseUrl: "postgres://u:p@db.example.com/app", localS3: true });
    const result = productionEnv(text, {
      domain: "example.com",
      emailUrl: "smtp+tls://u:p@mail.example.com:587",
    });
    const prod = parseEnv(result.text);
    expect(prod.COMPOSE_PROFILES).toBe("prod");
    expect(prod.DATABASE_URL).toBe("postgres://u:p@db.example.com/app?sslmode=require");
    expect(prod.POSTGRES_PASSWORD).toBe("");
    expect(prod.S3_ENDPOINT_URL).toBe("");
    expect(prod.EMAIL_URL).toBe("smtp+tls://u:p@mail.example.com:587");
    expect(result.todo.join(" ")).toContain("S3_");
  });

  it("quotes an SMTP URL with $ or # so Compose reads it literally", () => {
    const result = productionEnv(devEnv(), {
      domain: "example.com",
      emailUrl: "smtp+tls://u:pa$$w#rd@mail.example.com:587",
    });
    expect(result.text).toContain("EMAIL_URL='smtp+tls://u:pa$$w#rd@mail.example.com:587'");
    expect(parseEnv(result.text).EMAIL_URL).toBe("smtp+tls://u:pa$$w#rd@mail.example.com:587");
  });

  it("puts Umami's tables in a schema of the external database", () => {
    const text = devEnv({ databaseUrl: "postgres://u:p@db.example.com/app", analytics: true });
    const prod = parseEnv(productionEnv(text, { domain: "example.com" }).text);
    expect(prod.COMPOSE_PROFILES).toBe("prod,analytics");
    expect(prod.UMAMI_DATABASE_URL).toBe(
      "postgres://u:p@db.example.com/app?sslmode=require&uselibpqcompat=true&schema=umami",
    );
  });

  it("uses a database URL given to production instead of the bundled one", () => {
    const prod = parseEnv(
      productionEnv(devEnv(), { domain: "example.com", databaseUrl: "postgres://u:p@db.example.com/app" })
        .text,
    );
    expect(prod.COMPOSE_PROFILES).toBe("prod");
    expect(prod.DATABASE_URL).toBe("postgres://u:p@db.example.com/app?sslmode=require");
  });

  it("keeps the bundled database for the local run", () => {
    const text = devEnv({ databaseUrl: "postgres://u:p@db.example.com/app" });
    const prod = parseEnv(productionEnv(text, { domain: "site.localhost", bundledDatabase: true }).text);
    expect(prod.COMPOSE_PROFILES).toBe("prod,db");
    expect(prod.DATABASE_URL).toBe(`postgres://app:${prod.POSTGRES_PASSWORD}@db:5432/app`);
  });

  it("asks for the S3 settings with uploads in S3", () => {
    const text = devEnv();
    expect(productionEnv(text, { domain: "example.com" }).todo.join(" ")).not.toContain("S3_");
    const result = productionEnv(text, { domain: "example.com", media: "s3" });
    expect(result.todo).toContain(
      "Set the S3_* variables to your S3 service: uploads go to S3 in production.",
    );
    const local = productionEnv(devEnv({ localS3: true }), { domain: "example.com", media: "s3" });
    expect(local.todo.filter((item) => item.includes("S3_"))).toHaveLength(1);
  });

  it("validates the domain", () => {
    expect(validateDomain("example.com")).toBeUndefined();
    expect(validateDomain("https://example.com")).toBeDefined();
    expect(() => productionEnv("", { domain: "localhost" })).toThrow();
  });
});

describe("postgresUrl", () => {
  it("encodes special characters in the password, user and name", () => {
    const url = postgresUrl({
      host: "db.example.com",
      name: "my app",
      user: "me@x",
      password: "p@ss:w/rd#?%",
    });
    expect(url).toBe(
      "postgres://me%40x:p%40ss%3Aw%2Frd%23%3F%25@db.example.com:5432/my%20app?sslmode=require",
    );
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.password)).toBe("p@ss:w/rd#?%");
    expect(parsed.hostname).toBe("db.example.com");
  });

  it("keeps the port and needs no TLS on this machine", () => {
    expect(postgresUrl({ host: "localhost", port: "6543", name: "app", user: "app" })).toBe(
      "postgres://app@localhost:6543/app",
    );
  });
});

describe("writePrivateFile", () => {
  it("makes an existing file readable by its owner only", () => {
    const path = join(root, "existing.env");
    writeFileSync(path, "A=1\n", { mode: 0o644 });
    writePrivateFile(path, "A=2\n");
    expect(readFileSync(path, "utf8")).toBe("A=2\n");
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

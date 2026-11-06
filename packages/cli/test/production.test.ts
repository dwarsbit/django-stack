import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseEnv, productionEnv, scaffold, validateDomain } from "../src";

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

  it("keeps an external database and drops the local S3 service", () => {
    const text = devEnv({ databaseUrl: "postgres://u:p@db.example.com/app", localS3: true });
    const result = productionEnv(text, {
      domain: "example.com",
      emailUrl: "smtp+tls://u:p@mail.example.com:587",
    });
    const prod = parseEnv(result.text);
    expect(prod.COMPOSE_PROFILES).toBe("prod");
    expect(prod.DATABASE_URL).toBe("postgres://u:p@db.example.com/app?sslmode=require");
    expect(prod.S3_ENDPOINT_URL).toBe("");
    expect(prod.EMAIL_URL).toBe("smtp+tls://u:p@mail.example.com:587");
    expect(result.todo.join(" ")).toContain("S3_");
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

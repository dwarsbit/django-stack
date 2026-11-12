import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findEnvProjectDirectory, freshDevelopmentEnv } from "../src/dev-env";
import { parseEnv, setEnvValues } from "../src/env";
import { normalizeDatabaseUrl, scaffold } from "../src/scaffold";
import { DEFAULT_STACK, encodePreset } from "../src/stack";

const dirs: string[] = [];
function project(options: Partial<Parameters<typeof scaffold>[0]> = {}) {
  const parent = mkdtempSync(join(tmpdir(), "django-stack-"));
  dirs.push(parent);
  const directory = join(parent, "my-site");
  scaffold({ directory, name: "my-site", frontend: "astro", demoContent: true, ...options });
  return directory;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SECRETS = [
  "DJANGO_SECRET_KEY",
  "POSTGRES_PASSWORD",
  "API_SECRET_KEY",
  "API_READ_KEY",
  "PREVIEW_SECRET",
  "REVALIDATE_SECRET",
  "ADMIN_PASSWORD",
];

/** The .env without the values that differ every time. */
function withoutSecrets(text: string): Record<string, string> {
  const env = parseEnv(text);
  for (const name of [
    ...SECRETS,
    "DATABASE_URL",
    "UMAMI_ADMIN_PASSWORD",
    "UMAMI_APP_SECRET",
    "UMAMI_WEBSITE_ID",
    "UMAMI_DATABASE_URL",
  ])
    delete env[name];
  return env;
}

describe("dstack env", () => {
  it("writes the .env of init in a fresh clone, with other secrets", () => {
    const stack = {
      ...DEFAULT_STACK,
      analytics: "umami",
      cache: "valkey",
      storage: "s3",
      errors: "sentry",
    } as const;
    const directory = project({
      analytics: true,
      cache: "valkey",
      localS3: true,
      errors: "sentry",
      preset: encodePreset(stack),
    });
    const before = readFileSync(join(directory, ".env"), "utf8");
    unlinkSync(join(directory, ".env"));

    const result = freshDevelopmentEnv(directory);
    expect(result.replaces).toBe(false);
    expect(withoutSecrets(result.text)).toEqual(withoutSecrets(before));
    const env = parseEnv(result.text);
    const old = parseEnv(before);
    for (const name of SECRETS) {
      expect(env[name], name).toBeTruthy();
      expect(env[name], name).not.toBe(old[name]);
    }
    expect(env.DATABASE_URL).toBe(`postgres://app:${env.POSTGRES_PASSWORD}@db:5432/app`);
    expect(env.UMAMI_DATABASE_URL).toBe(`postgres://app:${env.POSTGRES_PASSWORD}@db:5432/app?schema=umami`);
    expect(env.COMPOSE_PROFILES).toBe("dev,db,s3,analytics,valkey");
    expect(result.adminPassword).toBe(env.ADMIN_PASSWORD);
  });

  it("keeps the ports, the stack and the production database of an existing .env", () => {
    const directory = project();
    const path = join(directory, ".env");
    writeFileSync(
      path,
      setEnvValues(readFileSync(path, "utf8"), {
        SITE_PORT: "3005",
        SITE_URL: "http://localhost:3005",
        BACKEND_URL: "http://localhost:3005",
        CACHE_URL: "locmem://",
        TASKS_URL: "immediate://",
        TASK_WORKERS: "0",
        SEED_DEMO_CONTENT: "0",
        PRODUCTION_DATABASE_URL: "postgres://user:pw@db.example.com:5432/app",
      }),
    );
    const result = freshDevelopmentEnv(directory);
    expect(result.replaces).toBe(true);
    const env = parseEnv(result.text);
    expect(env.SITE_PORT).toBe("3005");
    expect(env.SITE_URL).toBe("http://localhost:3005");
    expect(env.CACHE_URL).toBe("locmem://");
    expect(env.TASKS_URL).toBe("immediate://");
    expect(env.SEED_DEMO_CONTENT).toBe("0");
    expect(env.PRODUCTION_DATABASE_URL).toBe(
      normalizeDatabaseUrl("postgres://user:pw@db.example.com:5432/app"),
    );
    expect(parseEnv(freshDevelopmentEnv(directory, { demoContent: true }).text).SEED_DEMO_CONTENT).toBe("1");
  });

  it("finds a project without a .env", () => {
    const directory = project();
    unlinkSync(join(directory, ".env"));
    expect(findEnvProjectDirectory(join(directory, "backend"))).toBe(directory);
    expect(findEnvProjectDirectory(tmpdir())).toBeUndefined();
  });
});

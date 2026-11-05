import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRONTENDS,
  type Frontend,
  normalizeDatabaseUrl,
  parseEnv,
  scaffold,
  setEnvValues,
  toProjectName,
  validateProjectName,
} from "../src";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "django-stack-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("project names", () => {
  it("derives a name from a directory", () => {
    expect(toProjectName("My Site!")).toBe("my-site");
    expect(toProjectName("--a__b--")).toBe("a-b");
  });

  it("validates names", () => {
    expect(validateProjectName("my-site")).toBeUndefined();
    expect(validateProjectName("1site")).toBeDefined();
    expect(validateProjectName("My Site")).toBeDefined();
  });
});

describe("normalizeDatabaseUrl", () => {
  it("requires TLS for remote hosts", () => {
    expect(normalizeDatabaseUrl("postgres://u:p@db.example.com:5432/app")).toBe(
      "postgres://u:p@db.example.com:5432/app?sslmode=require",
    );
  });

  it("keeps local hosts and an explicit sslmode", () => {
    expect(normalizeDatabaseUrl("postgres://u:p@localhost/app")).toBe("postgres://u:p@localhost/app");
    expect(normalizeDatabaseUrl("postgres://u:p@h/app?sslmode=verify-full")).toContain("sslmode=verify-full");
  });

  it("rejects other URLs", () => {
    expect(() => normalizeDatabaseUrl("mysql://h/app")).toThrow();
    expect(() => normalizeDatabaseUrl("nope")).toThrow();
  });
});

describe("env files", () => {
  it("parses and updates values", () => {
    const text = "# comment\nA=1\nB='two words'\n";
    expect(parseEnv(text)).toEqual({ A: "1", B: "two words" });
    expect(setEnvValues(text, { A: "$1&", C: "3" })).toBe("# comment\nA=$1&\nB='two words'\nC=3\n");
  });
});

describe("frontend templates", () => {
  const templates = join(fileURLToPath(new URL("../../../templates", import.meta.url)));
  const frontends = readdirSync(templates)
    .filter((entry) => entry.startsWith("frontend-"))
    .map((entry) => entry.slice("frontend-".length));

  it("has a template for every generated frontend", () => {
    for (const frontend of FRONTENDS) expect(frontends).toContain(frontend);
  });

  it.each(frontends)("%s meets the frontend contract", (frontend) => {
    const directory = join(templates, `frontend-${frontend}`);
    const about = JSON.parse(readFileSync(join(directory, "template.json"), "utf8"));
    expect(Object.keys(about).sort()).toEqual(["label", "security", "url"]);
    for (const file of ["AGENTS.md", "Dockerfile", ".dockerignore", "vendor/.gitkeep"])
      expect(existsSync(join(directory, file)), file).toBe(true);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    for (const script of ["dev", "build", "start", "check", "test", "generate:types"])
      expect(manifest.scripts[script], script).toBeTruthy();
    expect(manifest.scripts["generate:types"]).toContain("src/lib/headless.ts");
    expect(existsSync(join(directory, "src/lib/headless.ts"))).toBe(true);
    const dockerfile = readFileSync(join(directory, "Dockerfile"), "utf8");
    for (const target of ["AS dev", "AS prod", "USER node", "HEALTHCHECK", "robots.txt"])
      expect(dockerfile, target).toContain(target);
  });

  it.each(frontends)("%s fills in the project's documents", (frontend) => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: frontend as Frontend, demoContent: true });
    for (const file of ["README.md", "AGENTS.md", "SECURITY.md", "package.json"]) {
      expect(readFileSync(join(directory, file), "utf8"), file).not.toMatch(/\{\{/);
    }
  });
});

describe("scaffold", () => {
  it("creates a project with fresh secrets", () => {
    const directory = join(tempDir(), "my-site");
    const result = scaffold({ directory, name: "my-site", frontend: "astro", demoContent: true });

    for (const file of [
      "compose.yaml",
      ".gitignore",
      ".env",
      ".env.example",
      "backend/manage.py",
      "backend/content/models.py",
      "frontend/astro.config.mjs",
      "frontend/src/pages/index.astro",
    ]) {
      expect(existsSync(join(directory, file)), file).toBe(true);
    }
    expect(existsSync(join(directory, "env.example"))).toBe(false);
    expect(existsSync(join(directory, "gitignore"))).toBe(false);
    expect(existsSync(join(directory, "frontend/template.json"))).toBe(false);

    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.PROJECT_NAME).toBe("my-site");
    expect(env.DJANGO_SECRET_KEY?.length).toBeGreaterThan(50);
    expect(env.API_SECRET_KEY).not.toBe(env.API_READ_KEY);
    expect(env.DATABASE_URL).toBe(`postgres://app:${env.POSTGRES_PASSWORD}@db:5432/app`);
    expect(env.ADMIN_PASSWORD).toBe(result.adminPassword);
    expect(env.SEED_DEMO_CONTENT).toBe("1");
    expect(env.COMPOSE_PROFILES).toBe("dev,db");

    const example = parseEnv(readFileSync(join(directory, ".env.example"), "utf8"));
    expect(example.DJANGO_SECRET_KEY).toBe("");
    expect(example.SITE_URL).toBe("http://localhost:3000");

    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).toContain("name: my-site");
    expect(compose).not.toMatch(/\{\{[a-z_]+\}\}/);
    expect(readFileSync(join(directory, "backend/pyproject.toml"), "utf8")).toContain(
      'name = "my-site-backend"',
    );
  });

  it("generates different secrets for each project", () => {
    const root = tempDir();
    scaffold({ directory: join(root, "a"), name: "a", frontend: "astro", demoContent: true });
    scaffold({ directory: join(root, "b"), name: "b", frontend: "astro", demoContent: true });
    const a = parseEnv(readFileSync(join(root, "a/.env"), "utf8"));
    const b = parseEnv(readFileSync(join(root, "b/.env"), "utf8"));
    expect(a.DJANGO_SECRET_KEY).not.toBe(b.DJANGO_SECRET_KEY);
  });

  it("uses an external database and no demo content", () => {
    const directory = join(tempDir(), "site");
    scaffold({
      directory,
      name: "site",
      frontend: "astro",
      demoContent: false,
      databaseUrl: "postgres://u:p@db.example.com/app",
    });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.DATABASE_URL).toBe("postgres://u:p@db.example.com/app?sslmode=require");
    expect(env.COMPOSE_PROFILES).toBe("dev");
    expect(env.SEED_DEMO_CONTENT).toBe("0");
  });

  it("uses the local S3 service", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, localS3: true });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.COMPOSE_PROFILES).toBe("dev,db,s3");
    expect(env.S3_ENDPOINT_URL).toBe("http://s3:8333");
    expect(env.S3_PUBLIC_URL).toBe("http://localhost:8333/media");
  });

  it("refuses a directory that is not empty", () => {
    const directory = tempDir();
    writeFileSync(join(directory, "file.txt"), "");
    expect(() => scaffold({ directory, name: "site", frontend: "astro", demoContent: true })).toThrow(
      /not empty/,
    );
  });

  it("refuses a frontend without a template", () => {
    const directory = join(tempDir(), "site");
    const templatesDir = tempDir();
    expect(() =>
      scaffold({ directory, name: "site", frontend: "astro", demoContent: true, templatesDir }),
    ).toThrow(/has no astro frontend/);
    expect(existsSync(directory)).toBe(false);
  });

  it("refuses an invalid name", () => {
    const directory = join(tempDir(), "x");
    expect(() => scaffold({ directory, name: "Bad Name", frontend: "astro", demoContent: true })).toThrow(
      /not valid/,
    );
  });

  it("sets the time zone of the backend", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, timeZone: "Europe/Amsterdam" });
    const settings = readFileSync(join(directory, "backend", "config", "settings.py"), "utf8");
    expect(settings).toContain('TIME_ZONE = "Europe/Amsterdam"');
  });

  it("refuses an unknown time zone", () => {
    const directory = join(tempDir(), "site");
    expect(() =>
      scaffold({ directory, name: "site", frontend: "astro", demoContent: true, timeZone: "Mars/Base" }),
    ).toThrow(/not a time zone/);
    expect(existsSync(directory)).toBe(false);
  });
});

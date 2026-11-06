import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSteps, restoreArgs } from "../src/commands/project";
import { applyStack, setManifestPreset } from "../src/config";
import { parseEnv } from "../src/env";
import {
  compose,
  findProjectDirectory,
  projectStack,
  projectUrls,
  readLocalRun,
  readProject,
} from "../src/project";
import { scaffold } from "../src/scaffold";
import { DEFAULT_STACK, decodePreset, encodePreset } from "../src/stack";

const dirs: string[] = [];
function project(env = "COMPOSE_PROFILES=dev,db\n") {
  const dir = mkdtempSync(join(tmpdir(), "django-stack-"));
  dirs.push(dir);
  writeFileSync(join(dir, "compose.yaml"), "name: my-site\nservices: {}\n");
  writeFileSync(join(dir, ".env"), env);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readProject", () => {
  it("finds the project from a subdirectory", () => {
    const dir = project();
    mkdirSync(join(dir, "backend", "content"), { recursive: true });
    expect(findProjectDirectory(join(dir, "backend", "content"))).toBe(dir);
    expect(readProject(join(dir, "backend")).name).toBe("my-site");
  });

  it("fails in one line outside a project", () => {
    const dir = mkdtempSync(join(tmpdir(), "django-stack-"));
    dirs.push(dir);
    expect(() => readProject(dir)).toThrow(/No DjangoStack project in .*compose\.yaml and \.env/);
  });

  it("uses the prod services with the prod profile", () => {
    const prod = readProject(project("COMPOSE_PROFILES=prod,db\nSITE_URL=https://example.com\n"));
    expect(prod.prod).toBe(true);
    expect(prod.services.backend).toBe("backend-prod");
    expect(projectUrls(prod)[1]).toEqual({ label: "Admin", url: "https://example.com/admin/" });
    expect(readLocalRun(prod)).toBeUndefined();
  });

  it("runs the local production run as its own Compose project", () => {
    const dir = project();
    writeFileSync(join(dir, ".env.run"), "COMPOSE_PROFILES=prod,db\nSITE_URL=https://site.localhost\n");
    const dev = readProject(dir);
    expect(dev.prod).toBe(false);
    const run = readLocalRun(dev);
    expect(run?.prod).toBe(true);
    expect(run?.name).toBe("my-site-run");
    if (!run) throw new Error("no local run");
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
    compose(run, ["up"], (_cmd, args, options) => {
      calls.push({ args, env: options.env });
      return 0;
    });
    expect(calls[0]?.args).toEqual([
      "compose",
      "--env-file",
      ".env.run",
      "--project-name",
      "my-site-run",
      "up",
    ]);
    expect(calls[0]?.env?.ENV_FILE).toBe(".env.run");
    expect(calls[0]?.env?.COMPOSE_PROFILES).toBe("prod,db");
  });
});

describe("projectStack", () => {
  it("reads the preset from package.json", () => {
    const dir = project();
    const stack = { ...DEFAULT_STACK, analytics: "off" as const, storage: "s3" as const };
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ "django-stack": { preset: encodePreset(stack) } }),
    );
    expect(projectStack(readProject(dir))).toEqual(stack);
  });

  it("takes analytics from the analytics profile", () => {
    const dir = project("COMPOSE_PROFILES=dev,db,analytics\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "django-stack": { preset: "a01" } }));
    expect(projectStack(readProject(dir)).analytics).toBe("umami");
    // The default preset from before Umami was generated, without the profile.
    writeFileSync(join(dir, ".env"), "COMPOSE_PROFILES=dev,db\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "django-stack": { preset: "a" } }));
    expect(projectStack(readProject(dir)).analytics).toBe("off");
  });

  it("takes the storage from .env without a preset", () => {
    expect(projectStack(readProject(project("COMPOSE_PROFILES=dev,db,s3\n"))).storage).toBe("s3");
  });

  it("is saved by scaffold", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "django-stack-")), "site");
    dirs.push(dir);
    scaffold({ directory: dir, name: "site", frontend: "astro", demoContent: true, preset: "a00000001" });
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(manifest["django-stack"].preset).toBe("a00000001");
    expect(readFileSync(join(dir, "compose.yaml"), "utf8")).toContain(`env_file: $\{ENV_FILE:-.env}`);
  });
});

describe("applyStack", () => {
  const dev = "COMPOSE_PROFILES=dev,db\nS3_BUCKET=\n";
  const local = { ...DEFAULT_STACK, storage: "local" as const };
  const s3 = { ...DEFAULT_STACK, storage: "s3" as const };

  it("turns the local S3 service on and off", () => {
    const on = applyStack(dev, parseEnv(dev), local, s3);
    const env = parseEnv(on.env);
    expect(env.COMPOSE_PROFILES).toBe("dev,db,s3");
    expect(env.S3_ENDPOINT_URL).toBe("http://s3:8333");
    expect(on.changes).toHaveLength(1);
    const off = parseEnv(applyStack(on.env, env, s3, local).env);
    expect(off.COMPOSE_PROFILES).toBe("dev,db");
    expect(off.S3_ENDPOINT_URL).toBe("");
    expect(off.S3_CREATE_BUCKET).toBe("0");
  });

  it("turns analytics on and off, keeping Umami's website", () => {
    const text = "COMPOSE_PROFILES=dev,db\nDATABASE_URL=postgres://app:pw@db:5432/app\nUMAMI_URL=\n";
    const off = { ...DEFAULT_STACK, analytics: "off" as const };
    const umami = { ...DEFAULT_STACK, analytics: "umami" as const };
    const on = applyStack(text, parseEnv(text), off, umami);
    const env = parseEnv(on.env);
    expect(env.COMPOSE_PROFILES).toBe("dev,db,analytics");
    expect(env.UMAMI_URL).toBe("http://umami:3000");
    expect(env.UMAMI_WEBSITE_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.UMAMI_DATABASE_URL).toBe("postgres://app:pw@db:5432/app?schema=umami");
    expect(env.UMAMI_ADMIN_PASSWORD?.length).toBeGreaterThan(20);
    const stopped = parseEnv(applyStack(on.env, env, umami, off).env);
    expect(stopped.COMPOSE_PROFILES).toBe("dev,db");
    expect(stopped.UMAMI_URL).toBe("");
    const again = parseEnv(applyStack(applyStack(on.env, env, umami, off).env, stopped, off, umami).env);
    expect(again.UMAMI_WEBSITE_ID).toBe(env.UMAMI_WEBSITE_ID);
    expect(again.UMAMI_ADMIN_PASSWORD).toBe(env.UMAMI_ADMIN_PASSWORD);
  });

  it("changes nothing for the same stack", () => {
    expect(applyStack(dev, parseEnv(dev), local, local)).toEqual({ env: dev, changes: [] });
  });

  it("refuses what it can't change yet", () => {
    expect(() => applyStack(dev, parseEnv(dev), local, { ...local, frontend: "next" })).toThrow(
      "--frontend next can't be set on an existing project in this version yet.",
    );
  });

  it("refuses the storage in production and with your own S3", () => {
    const prod = "COMPOSE_PROFILES=prod,db\n";
    expect(() => applyStack(prod, parseEnv(prod), local, s3)).toThrow(/prod profile/);
    const own = "COMPOSE_PROFILES=dev,db\nS3_ENDPOINT_URL=https://s3.example.com\n";
    expect(() => applyStack(own, parseEnv(own), local, s3)).toThrow(/s3\.example\.com/);
  });

  it("saves the preset in package.json", () => {
    const text = setManifestPreset('{"name":"site","django-stack":{"version":"0.1.0"}}', "a00000001");
    expect(JSON.parse(text)["django-stack"]).toEqual({ version: "0.1.0", preset: "a00000001" });
    expect(decodePreset("a00000001").storage).toBe("s3");
  });
});

describe("checkSteps", () => {
  it("runs the linters in development and the deploy checks in production", () => {
    const dev = checkSteps(readProject(project()), false).map((step) => step.name);
    expect(dev).toEqual(["Django system checks", "Migrations are up to date", "Ruff", "Frontend check"]);
    expect(checkSteps(readProject(project()), true)).toHaveLength(6);
    const prod = checkSteps(readProject(project("COMPOSE_PROFILES=prod,db\n")), true);
    expect(prod.map((step) => step.name)).toEqual(["Django deploy checks", "Migrations are up to date"]);
  });
});

describe("restoreArgs", () => {
  it("restores the database, its media, or a media archive", () => {
    expect(restoreArgs("site-20261104T030000Z.dump", {})).toEqual([
      "python",
      "manage.py",
      "restore_database",
      "site-20261104T030000Z.dump",
    ]);
    expect(restoreArgs("site-20261104T030000Z.dump", { media: true, yes: true }).slice(3)).toEqual([
      "site-20261104T030000Z.dump",
      "--media",
      "--yes",
    ]);
    expect(restoreArgs("site-20261104T030000Z.media.tar.gz", { media: true })[2]).toBe("restore_media");
  });
});

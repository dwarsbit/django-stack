import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheEnv,
  FRONTENDS,
  type Frontend,
  normalizeDatabaseUrl,
  parseEnv,
  scaffold,
  setEnvValues,
  setNotificationsApp,
  toProjectName,
  usesValkey,
  validateProjectName,
} from "../src";
import { frontendPackageManager, packageManagerValues, selectBlocks } from "../src/scaffold";
import { NODE_FRONTENDS } from "../src/stack";

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
    for (const frontend of FRONTENDS) if (frontend !== "headless") expect(frontends).toContain(frontend);
  });

  it.each(frontends.filter((frontend) => NODE_FRONTENDS.includes(frontend)))(
    "%s meets the frontend contract",
    (frontend) => {
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
    },
  );

  it.each(frontends)("%s fills in the project's documents", (frontend) => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: frontend as Frontend, demoContent: true });
    for (const file of ["README.md", "AGENTS.md", "SECURITY.md", "package.json"]) {
      expect(readFileSync(join(directory, file), "utf8"), file).not.toMatch(/\{\{/);
    }
  });
});

describe("selectBlocks", () => {
  it("keeps the blocks of the flags that are on", () => {
    const text = "a\n# @if frontend\nb\n# @end\n<!-- @if !frontend -->\nc\n<!-- @end -->\nd";
    expect(selectBlocks(text, { frontend: true })).toBe("a\nb\nd");
    expect(selectBlocks(text, { frontend: false })).toBe("a\nc\nd");
  });

  it("refuses unknown flags and unclosed blocks", () => {
    expect(() => selectBlocks("# @if other\n# @end", { frontend: true })).toThrow(/other/);
    expect(() => selectBlocks("# @if frontend\nb", { frontend: true })).toThrow(/@end/);
    expect(() => selectBlocks("# @end", { frontend: true })).toThrow(/@if/);
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
    expect(env.ERRORS).toBe("email");
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

  it.skipIf(process.platform === "win32")(
    "makes the scripts executable when the package lost the executable bit",
    () => {
      // npm and pnpm pack non-bin files as 0644; copy the templates that way.
      const templatesDir = join(tempDir(), "templates");
      cpSync(fileURLToPath(new URL("../templates", import.meta.url)), templatesDir, { recursive: true });
      for (const file of ["backend/entrypoint.sh", "backend/manage.py"]) {
        chmodSync(join(templatesDir, file), 0o644);
      }
      const directory = join(tempDir(), "site");
      scaffold({ directory, name: "site", frontend: "astro", demoContent: true, templatesDir });
      for (const file of ["backend/entrypoint.sh", "backend/manage.py"]) {
        expect(statSync(join(directory, file)).mode & 0o777, file).toBe(0o755);
      }
      expect(readFileSync(join(directory, "backend/Dockerfile"), "utf8")).toContain(
        'ENTRYPOINT ["sh", "/app/entrypoint.sh"]',
      );
    },
  );

  it("generates different secrets for each project", () => {
    const root = tempDir();
    scaffold({ directory: join(root, "a"), name: "a", frontend: "astro", demoContent: true });
    scaffold({ directory: join(root, "b"), name: "b", frontend: "astro", demoContent: true });
    const a = parseEnv(readFileSync(join(root, "a/.env"), "utf8"));
    const b = parseEnv(readFileSync(join(root, "b/.env"), "utf8"));
    expect(a.DJANGO_SECRET_KEY).not.toBe(b.DJANGO_SECRET_KEY);
  });

  it("turns error reports off", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, errors: "off" });
    expect(parseEnv(readFileSync(join(directory, ".env"), "utf8")).ERRORS).toBe("off");
  });

  it("reports errors to Sentry", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, errors: "sentry" });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.ERRORS).toBe("sentry");
    expect(env.SENTRY_DSN).toBe("");
  });

  it("keeps the bundled database in development with an external one for production", () => {
    const directory = join(tempDir(), "site");
    scaffold({
      directory,
      name: "site",
      frontend: "astro",
      demoContent: false,
      databaseUrl: "postgres://u:p@db.example.com/app",
    });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.PRODUCTION_DATABASE_URL).toBe("postgres://u:p@db.example.com/app?sslmode=require");
    expect(env.DATABASE_URL).toBe(`postgres://app:${env.POSTGRES_PASSWORD}@db:5432/app`);
    expect(env.COMPOSE_PROFILES).toBe("dev,db");
    expect(env.SEED_DEMO_CONTENT).toBe("0");
    const example = parseEnv(readFileSync(join(directory, ".env.example"), "utf8"));
    expect(example.PRODUCTION_DATABASE_URL).toBe("");
  });

  it("uses the local S3 service", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, localS3: true });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.COMPOSE_PROFILES).toBe("dev,db,s3");
    expect(env.S3_ENDPOINT_URL).toBe("http://s3:8333");
    expect(env.S3_PUBLIC_URL).toBe("http://localhost:8333/media");
  });

  it("publishes the development services on the given ports", () => {
    const directory = join(tempDir(), "site");
    scaffold({
      directory,
      name: "site",
      frontend: "astro",
      demoContent: true,
      localS3: true,
      ports: { SITE_PORT: 3001, BACKEND_PORT: 8000, MAIL_PORT: 8026, S3_PORT: 8334 },
    });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env).toMatchObject({
      SITE_PORT: "3001",
      BACKEND_PORT: "8000",
      MAIL_PORT: "8026",
      SITE_URL: "http://localhost:3001",
      BACKEND_URL: "http://localhost:3001",
      S3_PUBLIC_URL: "http://localhost:8334/media",
    });
    const readme = readFileSync(join(directory, "README.md"), "utf8");
    expect(readme).toContain("http://localhost:3001/admin/");
    expect(readme).toContain("http://localhost:8026");
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).toContain(`"127.0.0.1:\${SITE_PORT:-3000}:3000"`);
  });

  it("runs Umami for page analytics", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, analytics: true });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.COMPOSE_PROFILES).toBe("dev,db,analytics");
    expect(env.UMAMI_URL).toBe("http://umami:3000");
    expect(env.UMAMI_WEBSITE_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(env.UMAMI_DATABASE_URL).toBe(`postgres://app:${env.POSTGRES_PASSWORD}@db:5432/app?schema=umami`);
    expect(env.UMAMI_ADMIN_PASSWORD).not.toBe(env.ADMIN_PASSWORD);
    expect(env.UMAMI_APP_SECRET?.length).toBeGreaterThan(40);
    const example = parseEnv(readFileSync(join(directory, ".env.example"), "utf8"));
    expect(example.UMAMI_ADMIN_PASSWORD).toBe("");
  });

  it("leaves analytics off by default", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.UMAMI_URL).toBe("");
    expect(env.UMAMI_ADMIN_PASSWORD).toBe("");
  });

  it("keeps the cache and the tasks in the database by default", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env).toMatchObject({ CACHE_URL: "db://", TASKS_URL: "db://", TASK_WORKERS: "1" });
    expect(env.COMPOSE_PROFILES).toBe("dev,db");
  });

  it("creates a headless project: the API and the admin, no frontend", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "headless", demoContent: true, analytics: true });
    expect(existsSync(join(directory, "frontend"))).toBe(false);
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).not.toMatch(/frontend(-prod|-env|_node_modules|:)/);
    expect(compose).toContain('SITE_PORT:-3000}:8000"');
    const caddy = readFileSync(join(directory, "Caddyfile"), "utf8");
    expect(caddy).not.toMatch(/frontend:3000/);
    expect(caddy).toContain("reverse_proxy backend:8000");
    expect(readFileSync(join(directory, "backend", "config", "urls.py"), "utf8")).toContain(
      'include("django_stack.start")',
    );
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.REVALIDATE_URL).toBe("");
    expect(env.COMPOSE_PROFILES).toBe("dev,db");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    expect(manifest.scripts.test).toBe("docker compose exec backend pytest");
    expect(JSON.stringify(manifest.scripts)).not.toMatch(/frontend/);
    expect(manifest["django-stack"].frontend).toBe("headless");
    const deploy = readFileSync(join(directory, ".github", "workflows", "deploy.yml"), "utf8");
    expect(deploy).not.toMatch(/FRONTEND_IMAGE/);
    for (const file of [
      "README.md",
      "AGENTS.md",
      "SECURITY.md",
      "compose.yaml",
      "Caddyfile",
      ".env.example",
    ]) {
      const text = readFileSync(join(directory, file), "utf8");
      expect(text, file).not.toMatch(/\{\{|@if|@end/);
      expect(text, file).not.toMatch(/frontend\//);
    }
  });

  it("creates a Django templates project: the site in the backend, no frontend service", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "templates", demoContent: true, analytics: true });
    expect(existsSync(join(directory, "frontend"))).toBe(false);
    expect(existsSync(join(directory, "backend", "template.json"))).toBe(false);
    for (const file of ["views.py", "urls.py", "templates/website/base.html", "static/website/global.css"])
      expect(existsSync(join(directory, "backend", "website", file)), file).toBe(true);
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).not.toMatch(/frontend(-prod|-env|_node_modules|:)/);
    expect(compose).toContain('SITE_PORT:-3000}:8000"');
    const caddy = readFileSync(join(directory, "Caddyfile"), "utf8");
    expect(caddy).not.toMatch(/frontend:3000/);
    expect(caddy).toContain("reverse_proxy umami:3000");
    expect(caddy).toContain("reverse_proxy backend:8000");
    const urls = readFileSync(join(directory, "backend", "config", "urls.py"), "utf8");
    expect(urls).toContain('include("website.urls")');
    expect(urls).toContain('handler404 = "website.views.not_found"');
    expect(urls).not.toContain("django_stack.start");
    const settings = readFileSync(join(directory, "backend", "config", "settings.py"), "utf8");
    for (const line of [
      '"django_stack.contrib.site",',
      '"website",',
      '"django_stack.contrib.site.middleware.RedirectMiddleware",',
      '"website.context_processors.site",',
    ])
      expect(settings).toContain(line);
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.REVALIDATE_URL).toBe("");
    expect(env.COMPOSE_PROFILES).toBe("dev,db,analytics");
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    expect(JSON.stringify(manifest.scripts)).not.toMatch(/frontend/);
    expect(manifest["django-stack"].frontend).toBe("templates");
    const readme = readFileSync(join(directory, "README.md"), "utf8");
    expect(readme).toContain("backend/website/");
    expect(readme).toContain("## Analytics");
    for (const file of [
      "README.md",
      "AGENTS.md",
      "SECURITY.md",
      "compose.yaml",
      "Caddyfile",
      ".env.example",
    ]) {
      const text = readFileSync(join(directory, file), "utf8");
      expect(text, file).not.toMatch(/\{\{[a-z_]+\}\}|@if|@end/);
      expect(text, file).not.toMatch(/frontend\//);
    }
    // Django's own {{ }} survive: only {{name}} without spaces is the scaffold's.
    expect(
      readFileSync(join(directory, "backend", "website", "templates", "website", "base.html"), "utf8"),
    ).toContain("{{ site.site_name }}");
  });

  it("keeps a frontend project's blocks without the markers", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true });
    for (const file of ["README.md", "AGENTS.md", "compose.yaml", "Caddyfile", "backend/config/urls.py"]) {
      expect(readFileSync(join(directory, file), "utf8"), file).not.toMatch(/@if|@end/);
    }
    expect(readFileSync(join(directory, "compose.yaml"), "utf8")).toContain("frontend-prod:");
    expect(readFileSync(join(directory, "backend", "config", "urls.py"), "utf8")).not.toContain(
      "django_stack.start",
    );
  });

  it.each([
    ["stable", "17", "/var/lib/postgresql/data"],
    ["latest", "18", "/var/lib/postgresql"],
  ] as const)("runs Postgres %s", (postgres, version, data) => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true, postgres });
    const compose = readFileSync(join(directory, "compose.yaml"), "utf8");
    expect(compose).toContain(`image: postgres:${version}-alpine`);
    expect(compose).toContain(`- pgdata:${data}\n`);
    const dockerfile = readFileSync(join(directory, "backend", "Dockerfile"), "utf8");
    expect(dockerfile).toContain(`ARG POSTGRES_VERSION=${version}\n`);
  });

  it("runs Valkey for the cache or the tasks", () => {
    expect(cacheEnv({ cache: "valkey", tasks: "huey" })).toEqual({
      CACHE_URL: "redis://cache:6379/0",
      TASKS_URL: "redis://cache:6379/1",
      TASK_WORKERS: "1",
    });
    expect(cacheEnv({ cache: "database", tasks: "huey-valkey" }).TASKS_URL).toBe("redis://cache:6379/1");
    expect(cacheEnv({ cache: "off", tasks: "off" })).toEqual({
      CACHE_URL: "locmem://",
      TASKS_URL: "immediate://",
      TASK_WORKERS: "0",
    });
    expect(usesValkey({ CACHE_URL: "db://", TASKS_URL: "redis://cache:6379/1" })).toBe(true);
    expect(usesValkey({ CACHE_URL: "rediss://cache.example.com:6379" })).toBe(false);

    const directory = join(tempDir(), "site");
    scaffold({
      directory,
      name: "site",
      frontend: "astro",
      demoContent: true,
      cache: "valkey",
      tasks: "huey",
    });
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    expect(env.COMPOSE_PROFILES).toBe("dev,db,valkey");
    expect(env.CACHE_URL).toBe("redis://cache:6379/0");
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

  it("installs the notifications app unless notifications are off", () => {
    const settingsOf = (directory: string) =>
      readFileSync(join(directory, "backend", "config", "settings.py"), "utf8");
    const on = join(tempDir(), "on");
    scaffold({ directory: on, name: "site", frontend: "astro", demoContent: true });
    expect(settingsOf(on)).toContain('"content_studio.notifications",');
    const off = join(tempDir(), "off");
    scaffold({ directory: off, name: "site", frontend: "astro", demoContent: true, notifications: false });
    expect(settingsOf(off)).not.toContain("content_studio.notifications");

    // Back on, at the same place.
    expect(setNotificationsApp(settingsOf(off), true)).toBe(settingsOf(on));
    expect(setNotificationsApp(settingsOf(on), true)).toBe(settingsOf(on));
    expect(() => setNotificationsApp("INSTALLED_APPS = []\n", true)).toThrow(/content_studio/);
  });

  it("turns the captcha off in .env", () => {
    const on = join(tempDir(), "on");
    scaffold({ directory: on, name: "site", frontend: "astro", demoContent: true });
    expect(parseEnv(readFileSync(join(on, ".env"), "utf8")).CAPTCHA).toBe("on");
    expect(readFileSync(join(on, "backend", "config", "settings.py"), "utf8")).toContain(
      '"django_stack.contrib.captcha",',
    );
    const off = join(tempDir(), "off");
    scaffold({ directory: off, name: "site", frontend: "astro", demoContent: true, captcha: false });
    expect(parseEnv(readFileSync(join(off, ".env"), "utf8")).CAPTCHA).toBe("off");
  });

  it("installs the frontend with the chosen package manager", () => {
    const read = (directory: string, file: string) => readFileSync(join(directory, "frontend", file), "utf8");
    for (const frontend of FRONTENDS.filter((value) => NODE_FRONTENDS.includes(value))) {
      const pnpm = join(tempDir(), `${frontend}-pnpm`);
      scaffold({ directory: pnpm, name: "site", frontend, demoContent: true });
      expect(read(pnpm, "Dockerfile")).toContain("RUN npm install --global pnpm@");
      expect(read(pnpm, "Dockerfile")).toContain("pnpm install --frozen-lockfile");
      expect(read(pnpm, "Dockerfile")).not.toContain("{{");
      expect(JSON.parse(read(pnpm, "package.json")).packageManager).toMatch(/^pnpm@\d/);
      expect(read(pnpm, "pnpm-workspace.yaml")).toContain("minimumReleaseAge: 1440");

      const bun = join(tempDir(), `${frontend}-bun`);
      scaffold({ directory: bun, name: "site", frontend, demoContent: true, packageManager: "bun" });
      expect(read(bun, "Dockerfile")).toContain("COPY --from=oven/bun:");
      expect(read(bun, "Dockerfile")).toContain("bun install --frozen-lockfile");
      expect(existsSync(join(bun, "frontend", "pnpm-workspace.yaml"))).toBe(false);

      const npm = join(tempDir(), `${frontend}-npm`);
      scaffold({ directory: npm, name: "site", frontend, demoContent: true, packageManager: "npm" });
      expect(read(npm, "Dockerfile")).toContain("npm ci");
      expect(JSON.parse(read(npm, "package.json")).packageManager).toBeUndefined();
      expect(readFileSync(join(npm, "README.md"), "utf8")).toContain("`npm run test`");
      expect(readFileSync(join(pnpm, "README.md"), "utf8")).toContain("`pnpm test`");
    }
  });

  it("knows the package manager from the lockfile", () => {
    const directory = join(tempDir(), "site");
    scaffold({ directory, name: "site", frontend: "astro", demoContent: true });
    expect(frontendPackageManager(directory)).toBeUndefined();
    writeFileSync(join(directory, "frontend", "bun.lock"), "{}");
    expect(frontendPackageManager(directory)).toBe("bun");
    expect(packageManagerValues("npm").pm_backend).toBe("npm run backend --");
  });

  it("refuses an unknown time zone", () => {
    const directory = join(tempDir(), "site");
    expect(() =>
      scaffold({ directory, name: "site", frontend: "astro", demoContent: true, timeZone: "Mars/Base" }),
    ).toThrow(/not a time zone/);
    expect(existsSync(directory)).toBe(false);
  });
});

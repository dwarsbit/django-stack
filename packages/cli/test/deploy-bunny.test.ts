import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Ask,
  appRequest,
  BUNNY_DEPLOYS_DIR,
  BunnyClient,
  bunny,
  bunnyState,
  type CommandRunner,
  type ComposeProject,
  durationSeconds,
  parsePublicImage,
  planApp,
  pushTarget,
  registryKind,
  rewriteHosts,
} from "../src/deploy";

const CADDYFILE = `{$CADDY_ADDRESS} {
	@django path /admin /admin/* /api /api/* /static/*
	handle @django {
		reverse_proxy backend:8000
	}
	handle {
		reverse_proxy frontend:3000
	}
}
`;

function fixture(): ComposeProject {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/bunny-compose.json"), "utf8")) as ComposeProject;
}

const readFile = (path: string) => {
  if (path === "/project/Caddyfile") return CADDYFILE;
  throw new Error("not a file");
};

describe("Compose to Bunny", () => {
  it("reads durations and public images", () => {
    expect(durationSeconds("1m0s", 0)).toBe(60);
    expect(durationSeconds("1m30s", 0)).toBe(90);
    expect(durationSeconds("500ms", 0)).toBe(0.5);
    expect(durationSeconds(undefined, 7)).toBe(7);
    expect(parsePublicImage("postgres:17-alpine")).toEqual({
      source: "dockerHub",
      namespace: "library",
      name: "postgres",
      tag: "17-alpine",
    });
    expect(parsePublicImage("valkey/valkey:8-alpine")).toMatchObject({
      namespace: "valkey",
      tag: "8-alpine",
    });
    expect(parsePublicImage("ghcr.io/owner/app")).toMatchObject({ source: "gitHub", tag: "latest" });
    expect(() => parsePublicImage("quay.io/owner/app:1")).toThrow(/Docker Hub and GitHub/);
  });

  it("points service hosts at the pod", () => {
    expect(rewriteHosts("postgres://app:pw@db:5432/app", ["db"])).toBe(
      "postgres://app:pw@127.0.0.1:5432/app",
    );
    expect(rewriteHosts("http://backend:8000/api", ["backend"])).toBe("http://127.0.0.1:8000/api");
    // Only whole host names.
    expect(rewriteHosts("http://mydb:5432 db.example.com:5432", ["db"])).toBe(
      "http://mydb:5432 db.example.com:5432",
    );
  });

  it("plans one pod from the template", () => {
    const plan = planApp(fixture(), { readFile });
    const byName = Object.fromEntries(plan.containers.map((item) => [item.name, item]));
    expect(Object.keys(byName).sort()).toEqual(["backend", "cache", "db", "frontend", "proxy", "worker"]);
    expect(byName.backend?.ports).toEqual([8000]);
    expect(byName.frontend?.ports).toEqual([3000]);
    expect(byName.db?.ports).toEqual([5432]);
    expect(byName.cache?.ports).toEqual([6379]);
    expect(byName.proxy?.endpoint).toBe(80);
    expect(byName.backend?.endpoint).toBeUndefined();

    // Hosts of other services are the pod's.
    expect(byName.backend?.env.DATABASE_URL).toBe("postgres://app:test-postgres-password@127.0.0.1:5432/app");
    expect(byName.backend?.env.CACHE_URL).toBe("redis://127.0.0.1:6379/0");
    expect(byName.backend?.env.REVALIDATE_URL).toBe("http://127.0.0.1:3000/revalidate");
    expect(byName.frontend?.env.API_URL).toBe("http://127.0.0.1:8000/api");
    expect(byName.backend?.env.COMPOSE_PROFILES).toBeUndefined();
    // The frontend still gets only its own variables.
    expect(byName.frontend?.env.DJANGO_SECRET_KEY).toBeUndefined();

    // One volume, for Postgres, in a subdirectory.
    expect(plan.volumes).toEqual(["pgdata"]);
    expect(byName.db?.volumeMounts).toEqual([{ name: "pgdata", mountPath: "/var/lib/postgresql/data" }]);
    expect(byName.db?.env.PGDATA).toBe("/var/lib/postgresql/data/pgdata");
    expect(byName.backend?.volumeMounts).toEqual([]);
    expect(byName.proxy?.volumeMounts).toEqual([]);

    // The backend image is built once for the backend and the worker; the Caddyfile is baked.
    expect(plan.builds.map((build) => build.repository).sort()).toEqual([
      "site-backend",
      "site-frontend",
      "site-proxy",
    ]);
    const proxy = plan.builds.find((build) => build.repository === "site-proxy");
    expect(proxy).toMatchObject({ kind: "bake", from: "caddy:2.11-alpine" });
    if (proxy?.kind !== "bake") throw new Error("no bake");
    expect(proxy.files[0]?.target).toBe("/etc/caddy/Caddyfile");
    expect(proxy.files[0]?.content).toContain("reverse_proxy 127.0.0.1:8000");
    expect(proxy.files[0]?.content).toContain("reverse_proxy 127.0.0.1:3000");
    expect(byName.worker?.image).toEqual({ source: "push", repository: "site-backend" });
    expect(byName.worker?.args).toEqual(["python", "manage.py", "run_huey"]);
    expect(byName.db?.image).toMatchObject({ source: "dockerHub", namespace: "library", name: "postgres" });

    // Health checks become probes: HTTP for the backend, TCP for the rest.
    expect(byName.backend?.probe).toMatchObject({ http: { path: "/readyz", port: 8000 }, periodSeconds: 5 });
    expect(byName.backend?.probe?.startupThreshold).toBe(42);
    expect(byName.db?.probe).toMatchObject({ tcp: { port: 5432 } });
    expect(byName.proxy?.probe).toMatchObject({ tcp: { port: 80 } });
    expect(byName.worker?.probe).toBeUndefined();
    expect(plan.ignored).toContain("read_only");
  });

  it("needs S3 for uploads", () => {
    const project = fixture();
    for (const service of Object.values(project.services))
      if (service.environment?.S3_BUCKET !== undefined) service.environment.S3_BUCKET = "";
    expect(() => planApp(project, { readFile })).toThrow(/S3/);
  });

  it("refuses two services on one port, and moves Umami", () => {
    const project = fixture();
    project.services.umami = {
      image: "umamisoftware/umami:postgresql-latest",
      environment: { DATABASE_URL: "postgres://app:pw@db:5432/app?schema=umami" },
    };
    if (project.services["backend-prod"]?.environment)
      project.services["backend-prod"].environment.UMAMI_URL = "http://umami:3000";
    const plan = planApp(project, { readFile });
    const umami = plan.containers.find((item) => item.name === "umami");
    expect(umami?.ports).toEqual([3001]);
    expect(umami?.env.PORT).toBe("3001");
    expect(plan.containers.find((item) => item.name === "backend")?.env.UMAMI_URL).toBe(
      "http://127.0.0.1:3001",
    );

    project.services.other = { image: "nginx:1", environment: {} };
    if (project.services["backend-prod"]?.environment)
      project.services["backend-prod"].environment.OTHER_URL = "http://other:8000";
    expect(() => planApp(project, { readFile })).toThrow(/both listen on port 8000/);
  });

  it("refuses more volumes than Bunny allows", () => {
    const project = fixture();
    project.services.extra = {
      image: "redis:7",
      volumes: [
        { type: "volume", source: "one", target: "/one" },
        { type: "volume", source: "two", target: "/two" },
      ],
    };
    expect(() => planApp(project, { readFile })).toThrow(/2 volumes per app/);
  });

  it("builds the app request", () => {
    const plan = planApp(fixture(), { readFile });
    const body = appRequest(plan, {
      registries: { dockerHub: "1", bunny: "9" },
      pushRegistry: "9",
      namespace: "12345",
      tag: "abc1234",
      region: "DE",
      volumeSize: 10,
    });
    expect(body.autoScaling).toEqual({ min: 1, max: 1 });
    expect(body.regionSettings.requiredRegionIds).toEqual(["DE"]);
    expect(body.volumes).toEqual([{ name: "pgdata", size: 10 }]);
    const proxy = body.containerTemplates.find((item) => item.name === "proxy");
    expect(proxy).toMatchObject({
      imageRegistryId: "9",
      imageNamespace: "12345",
      imageName: "site-proxy",
      imageTag: "abc1234",
      endpoints: [
        { displayName: "site", cdn: { isSslEnabled: false, portMappings: [{ containerPort: 80 }] } },
      ],
    });
    const db = body.containerTemplates.find((item) => item.name === "db");
    expect(db).toMatchObject({ imageRegistryId: "1", imageNamespace: "library", imageName: "postgres" });
    const backend = body.containerTemplates.find((item) => item.name === "backend");
    expect(backend?.probes?.readiness).toMatchObject({
      httpGet: { request: { path: "/readyz", portNumber: 8000 }, response: { expectedStatusCode: "ok" } },
    });
    const worker = body.containerTemplates.find((item) => item.name === "worker");
    expect(worker?.entryPoint).toEqual({ argumentsArray: ["python", "manage.py", "run_huey"] });
  });

  it("maps Bunny's words for an app's state", () => {
    expect(bunnyState("Running")).toBe("running");
    expect(bunnyState("Failing")).toBe("degraded");
    expect(bunnyState("Stopped")).toBe("stopped");
    expect(bunnyState(undefined)).toBe("unknown");
  });

  it("is a token provider with one API", () => {
    expect(bunny.auth.kind).toBe("token");
    expect(bunny.source).toBe("local");
    expect(bunny.target.fixed).toBe("https://api.bunny.net");
    expect(bunny.target.normalize("anything")).toBe("https://api.bunny.net");
  });
});

type Handler = (body: unknown) => unknown;

/** A fake Bunny API: a handler per "METHOD /path", and a log of the calls. */
function fakeBunny(
  handlers: Record<string, Handler>,
  run: CommandRunner,
  ghcrToken: { get(owner: string): string | undefined; save(owner: string, token: string): void } = {
    get: () => undefined,
    save: () => {},
  },
) {
  const calls: { method: string; path: string; body?: unknown; key?: string }[] = [];
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const path = `${url.pathname}${url.search}`;
    const method = String(init.method ?? "GET");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, key: (init.headers as Record<string, string>)?.AccessKey });
    const handler = handlers[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ title: `No ${method} ${path}` }), { status: 404 });
    const result = handler(body);
    if (result instanceof Response) return result;
    return new Response(result === undefined ? "" : JSON.stringify(result), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new BunnyClient("key", fetchImpl, {
    run,
    readFile,
    edgeServers: async () => ["203.0.113.1", "203.0.113.2"],
    now: () => new Date("2026-11-06T10:00:00Z"),
    ghcrToken,
  });
  return { calls, client };
}

/** A fake docker, git and tar: records the commands and answers compose config with the fixture. */
function fakeRunner() {
  const commands: {
    command: string;
    args: string[];
    env?: Record<string, string | undefined>;
    input?: unknown;
  }[] = [];
  const run: CommandRunner = async (command, args, options = {}) => {
    commands.push({ command, args, env: options.env, input: options.input });
    if (command === "git" && args.includes("log"))
      return { code: 0, stdout: "abc1234\nAdd a page\n", stderr: "" };
    if (command === "git" && args.includes("status")) return { code: 0, stdout: "", stderr: "" };
    if (command === "docker" && args[0] === "compose")
      return { code: 0, stdout: JSON.stringify(fixture()), stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { commands, run };
}

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "dstack-bunny-test-"));
  writeFileSync(join(directory, ".env.production"), "SITE_URL=https://example.com\n");
  mkdirSync(join(directory, ".dstack"), { recursive: true });
  return directory;
}

const containers = [
  {
    id: "c-backend",
    name: "backend",
    imageNamespace: "12345",
    imageName: "site-backend",
    imageTag: "old1111",
  },
  { id: "c-worker", name: "worker", imageNamespace: "12345", imageName: "site-backend", imageTag: "old1111" },
  {
    id: "c-frontend",
    name: "frontend",
    imageNamespace: "12345",
    imageName: "site-frontend",
    imageTag: "old1111",
  },
  { id: "c-proxy", name: "proxy", imageNamespace: "12345", imageName: "site-proxy", imageTag: "old1111" },
  { id: "c-db", name: "db", imageNamespace: "library", imageName: "postgres", imageTag: "17-alpine" },
  { id: "c-cache", name: "cache", imageNamespace: "valkey", imageName: "valkey", imageTag: "8-alpine" },
];

const link = {
  provider: "bunny",
  url: "https://api.bunny.net",
  project: "app1",
  environment: "12345",
  application: "777",
};

describe("BunnyClient", () => {
  it("finds the built-in registries by host name", async () => {
    expect(registryKind({ hostName: "docker.io", isPublic: true })).toBe("dockerHub");
    expect(registryKind({ hostName: "registry-1.docker.io" })).toBe("dockerHub");
    expect(registryKind({ hostName: "ghcr.io", isPublic: true })).toBe("gitHub");
    expect(registryKind({ hostName: "registry.bunny.net" })).toBe("bunny");
    expect(registryKind({ hostName: "quay.io" })).toBeUndefined();
    expect(registryKind({ displayName: "Docker Hub" })).toBe("dockerHub");
    const { client } = fakeBunny(
      {
        "GET /mc/registries": () => ({
          items: [
            { id: 4, displayName: "My Docker Hub", hostName: "docker.io", isPublic: false },
            { id: 2, displayName: "GitHub", hostName: "ghcr.io", isPublic: true, isPlatformManaged: true },
            {
              id: 1,
              displayName: "Docker Hub",
              hostName: "docker.io",
              isPublic: true,
              isPlatformManaged: true,
            },
            { id: 9, displayName: "Bunny", hostName: "registry.bunny.net", accountId: "123" },
          ],
        }),
      },
      fakeRunner().run,
    );
    expect(await client.registries()).toMatchObject({
      registries: { dockerHub: "1", gitHub: "2", bunny: "9" },
      namespace: "123",
    });
  });

  it("sends the API key", async () => {
    const { calls, client } = fakeBunny(
      { "GET /mc/apps": () => ({ items: [{ id: "a" }] }) },
      fakeRunner().run,
    );
    expect(await client.verify()).toBe("Magic Containers (1 app)");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/mc/apps", key: "key" });
  });

  it("explains a refused key", async () => {
    const { client } = fakeBunny(
      { "GET /mc/apps": () => new Response("", { status: 401 }) },
      fakeRunner().run,
    );
    await expect(client.verify()).rejects.toThrow(/account API key|api-key/);
  });

  it("sets up the app, the pull zone and the hostname", async () => {
    const directory = project();
    const { commands, run } = fakeRunner();
    let created: Record<string, unknown> | undefined;
    const { calls, client } = fakeBunny(
      {
        "GET /mc/registries": () => [
          { id: 1, displayName: "Docker Hub", hostName: "docker.io", isPublic: true },
          { id: 9, displayName: "Bunny", hostName: "registry.bunny.net" },
        ],
        "GET /mc/regions/optimal": () => ({ id: "DE" }),
        "GET /mc/regions": () => [{ id: "DE", name: "Frankfurt" }],
        "POST /mc/apps": (body) => {
          created = body as Record<string, unknown>;
          return { id: "app1" };
        },
        "POST /mc/apps/app1/deploy": () => undefined,
        "GET /mc/apps/app1/endpoints": () => ({ items: [{ displayName: "site", cdn: { pullZoneId: 777 } }] }),
        "POST /pullzone/777": () => undefined,
        "GET /pullzone/777": () => ({ Name: "site-mc", Hostnames: [{ Value: "site-mc.b-cdn.net" }] }),
        "POST /pullzone/777/addHostname": () => undefined,
        "POST /pullzone/777/edgerules/addOrUpdate": () => undefined,
        "GET /pullzone/loadFreeCertificate?hostname=example.com": () =>
          new Response(JSON.stringify({ Message: "DNS not found" }), { status: 400 }),
      },
      run,
    );
    const steps: string[] = [];
    const ask = {
      interactive: false,
      select: async (_message: string, _choices: unknown, initial: unknown) => initial,
      text: async () => {
        throw new Error("asked");
      },
      step: (message: string) => steps.push(message),
    } as unknown as Ask;
    const ids = await client.setup({
      ask,
      directory,
      name: "site",
      branch: "main",
      domain: "example.com",
      env: { SITE_URL: "https://example.com", CADDY_ADDRESS: ":80" },
      options: { account: "12345" },
    });
    expect(ids).toEqual({ project: "app1", environment: "12345", application: "777" });

    // Images are built for amd64 and pushed with a throwaway login.
    const builds = commands.filter((item) => item.command === "docker" && item.args[0] === "build");
    expect(builds).toHaveLength(3);
    expect(builds[0]?.args).toContain("linux/amd64");
    const pushes = commands
      .filter((item) => item.args[0] === "push")
      .map((item) => item.args[1])
      .sort();
    expect(pushes).toEqual([
      "registry.bunny.net/12345/site-backend:abc1234",
      "registry.bunny.net/12345/site-frontend:abc1234",
      "registry.bunny.net/12345/site-proxy:abc1234",
    ]);
    const login = commands.find((item) => item.args[0] === "login");
    expect(login?.args).toEqual(["login", "registry.bunny.net", "--username", "token", "--password-stdin"]);
    expect(login?.input).toBe("key");
    expect(login?.env?.DOCKER_CONFIG).toBeTruthy();
    // Compose resolves with the edge servers as trusted proxies.
    const config = commands.find((item) => item.args[0] === "compose");
    expect(config?.env?.TRUSTED_PROXIES).toBe("203.0.113.1 203.0.113.2");

    expect(created?.name).toBe("site");
    expect(calls.find((item) => item.path === "/pullzone/777/addHostname")?.body).toEqual({
      Hostname: "example.com",
    });
    expect(calls.find((item) => item.path === "/pullzone/777")?.body).toEqual({ AddHostHeader: true });
    expect(steps.join("\n")).toContain("example.com CNAME site-mc.b-cdn.net");
    expect(steps.join("\n")).toContain("apex domain");

    const records = readFileSync(join(directory, BUNNY_DEPLOYS_DIR, ".gitignore"), "utf8");
    expect(records).toBe("*\n");
  });

  describe("a domain that is already on another pull zone", () => {
    const search = "GET /pullzone?search=example.com&perPage=1000";
    function handlers(extra: Record<string, Handler>): Record<string, Handler> {
      return {
        "GET /mc/registries": () => [
          { id: 1, displayName: "Docker Hub", hostName: "docker.io", isPublic: true },
          { id: 9, displayName: "Bunny", hostName: "registry.bunny.net" },
        ],
        "GET /mc/regions/optimal": () => ({ id: "DE" }),
        "GET /mc/regions": () => [{ id: "DE", name: "Frankfurt" }],
        "POST /mc/apps": () => ({ id: "app1" }),
        "POST /mc/apps/app1/deploy": () => undefined,
        "GET /mc/apps/app1/endpoints": () => ({ items: [{ cdn: { pullZoneId: 777 } }] }),
        "POST /pullzone/777": () => undefined,
        "GET /pullzone/777": () => ({ Name: "site-mc", Hostnames: [{ Value: "site-mc.b-cdn.net" }] }),
        "POST /pullzone/777/addHostname": () => undefined,
        "POST /pullzone/777/edgerules/addOrUpdate": () => undefined,
        ...extra,
      };
    }
    function asker(interactive: boolean, answer = true) {
      const steps: string[] = [];
      const ask = {
        interactive,
        select: async (_message: string, _choices: unknown, initial: unknown) => initial,
        confirm: async () => answer,
        text: async () => {
          throw new Error("asked");
        },
        step: (message: string) => steps.push(message),
      } as unknown as Ask;
      return { ask, steps };
    }
    const context = (ask: Ask) => ({
      ask,
      directory: project(),
      name: "site",
      branch: "main",
      domain: "example.com",
      env: { SITE_URL: "https://example.com", CADDY_ADDRESS: ":80" },
      options: { account: "12345" },
    });
    const oldZone = () => ({
      Items: [
        { Id: 555, Name: "old-mc", Hostnames: [{ Value: "old-mc.b-cdn.net" }, { Value: "Example.com" }] },
      ],
    });

    it("moves it from the old pull zone when the user agrees", async () => {
      const { calls, client } = fakeBunny(
        handlers({ [search]: oldZone, "DELETE /pullzone/555/removeHostname": () => undefined }),
        fakeRunner().run,
      );
      const { ask, steps } = asker(true);
      await client.setup(context(ask));
      const remove = calls.findIndex((item) => item.path === "/pullzone/555/removeHostname");
      const add = calls.findIndex((item) => item.path === "/pullzone/777/addHostname");
      expect(calls[remove]?.body).toEqual({ Hostname: "example.com" });
      expect(remove).toBeGreaterThan(-1);
      expect(add).toBeGreaterThan(remove);
      expect(steps.join("\n")).toContain("Removed example.com from the CDN pull zone old-mc (555)");
    });

    it("stops before creating anything without a terminal, or when the user declines", async () => {
      for (const { ask } of [asker(false), asker(true, false)]) {
        const { calls, client } = fakeBunny(handlers({ [search]: oldZone }), fakeRunner().run);
        await expect(client.setup(context(ask))).rejects.toThrow(
          /example\.com is already on the CDN pull zone old-mc \(555\)\. Remove it there/,
        );
        expect(calls.some((item) => item.path === "/mc/apps" && item.method === "POST")).toBe(false);
      }
    });

    it("explains a hostname Bunny refuses that is not on a pull zone of the account", async () => {
      const { client } = fakeBunny(
        handlers({
          "POST /pullzone/777/addHostname": () =>
            new Response(JSON.stringify({ Message: "The hostname is already registered." }), { status: 400 }),
        }),
        fakeRunner().run,
      );
      await expect(client.setup(context(asker(true).ask))).rejects.toThrow(
        /already registered, but not on a pull zone of this account/,
      );
    });
  });

  it("pushes to a private ghcr.io package that Bunny pulls with the token", async () => {
    expect(pushTarget("ghcr.io/acme")).toEqual({ host: "ghcr.io", namespace: "acme" });
    expect(pushTarget("12345")).toEqual({ host: "registry.bunny.net", namespace: "12345" });
    const directory = project();
    const { commands, run } = fakeRunner();
    let created: Record<string, unknown> | undefined;
    const saved: string[] = [];
    const { calls, client } = fakeBunny(
      {
        "GET /mc/registries": () => [
          { id: 1, displayName: "Docker Hub", hostName: "docker.io", isPublic: true },
          { id: 2, displayName: "GitHub", hostName: "ghcr.io", isPublic: true },
        ],
        "POST /mc/registries": () => ({ id: 5, status: "saved" }),
        "GET /mc/regions/optimal": () => ({ id: "DE" }),
        "GET /mc/regions": () => [{ id: "DE", name: "Frankfurt" }],
        "POST /mc/apps": (body) => {
          created = body as Record<string, unknown>;
          return { id: "app1" };
        },
        "POST /mc/apps/app1/deploy": () => undefined,
        "GET /mc/apps/app1/endpoints": () => ({ items: [{ displayName: "site", cdn: { pullZoneId: 777 } }] }),
        "POST /pullzone/777": () => undefined,
        "GET /pullzone/777": () => ({ Name: "site-mc", Hostnames: [{ Value: "site-mc.b-cdn.net" }] }),
        "POST /pullzone/777/addHostname": () => undefined,
        "POST /pullzone/777/edgerules/addOrUpdate": () => undefined,
        "GET /pullzone/loadFreeCertificate?hostname=example.com": () =>
          new Response(JSON.stringify({ Message: "DNS not found" }), { status: 400 }),
      },
      run,
      { get: (owner) => (saved.includes(owner) ? "ghp_x" : undefined), save: (owner) => saved.push(owner) },
    );
    const ask = {
      interactive: true,
      select: async (_message: string, _choices: unknown, initial: unknown) => initial,
      text: async () => "Acme",
      password: async () => "ghp_x",
      step: () => {},
    } as unknown as Ask;
    const ids = await client.setup({
      ask,
      directory,
      name: "site",
      branch: "main",
      domain: "example.com",
      env: { SITE_URL: "https://example.com", CADDY_ADDRESS: ":80" },
      options: {},
    });
    expect(ids.environment).toBe("ghcr.io/acme");
    expect(saved).toEqual(["acme"]);
    expect(calls.find((item) => item.method === "POST" && item.path === "/mc/registries")?.body).toEqual({
      displayName: "GitHub acme",
      type: "gitHub",
      passwordCredentials: { userName: "acme", password: "ghp_x" },
    });
    const login = commands.find((item) => item.args[0] === "login");
    expect(login?.args).toEqual(["login", "ghcr.io", "--username", "acme", "--password-stdin"]);
    expect(login?.input).toBe("ghp_x");
    expect(commands.filter((item) => item.args[0] === "push").map((item) => item.args[1])).toContain(
      "ghcr.io/acme/site-backend:abc1234",
    );
    const proxy = ((created?.containerTemplates ?? []) as Record<string, unknown>[]).find(
      (item) => item.name === "proxy",
    );
    expect(proxy).toMatchObject({ imageRegistryId: "5", imageNamespace: "acme", imageName: "site-proxy" });
  });

  it("deploys new images by changing the containers' tags", async () => {
    const directory = project();
    const { commands, run } = fakeRunner();
    let state = { status: "Running", containerTemplates: containers };
    const { calls, client } = fakeBunny(
      {
        "GET /mc/apps/app1": () => state,
        "PATCH /mc/apps/app1/containers/c-backend": () => undefined,
        "PATCH /mc/apps/app1/containers/c-worker": () => undefined,
        "PATCH /mc/apps/app1/containers/c-frontend": () => undefined,
        "PATCH /mc/apps/app1/containers/c-proxy": () => undefined,
        "GET /pullzone/777": () => ({ Hostnames: [{ Value: "example.com", HasCertificate: true }] }),
      },
      run,
    );
    const linked = { ...link, directory };
    const id = await client.deploy(linked, { force: false, directory });
    expect(id).toBe("20261106-100000-abc1234");
    const patched = calls.filter((item) => item.method === "PATCH");
    expect(patched.map((item) => item.path)).toEqual([
      "/mc/apps/app1/containers/c-backend",
      "/mc/apps/app1/containers/c-frontend",
      "/mc/apps/app1/containers/c-proxy",
      "/mc/apps/app1/containers/c-worker",
    ]);
    expect(patched[0]?.body).toEqual({ imageTag: "abc1234" });
    expect(commands.filter((item) => item.args[0] === "push")).toHaveLength(3);

    // Bunny still runs the old tag: the deploy is queued; then it rolls out.
    expect((await client.deployment(linked, id)).status).toBe("queued");
    state = {
      status: "Deploying",
      containerTemplates: containers.map((item) =>
        item.imageNamespace === "12345" ? { ...item, imageTag: "abc1234" } : item,
      ),
    };
    expect((await client.deployment(linked, id)).status).toBe("building");
    state = { ...state, status: "Running" };
    const done = await client.deployment(linked, id);
    expect(done.status).toBe("finished");
    expect(done.log.map((line) => line.text)).toContain("Bunny is rolling out abc1234");

    // The same commit again deploys nothing.
    const again = await client.deploy(linked, { force: false, directory });
    expect(calls.filter((item) => item.method === "PATCH")).toHaveLength(4);
    expect((await client.deployment(linked, again)).log[0]?.text).toMatch(/already runs abc1234/);
  });

  it("rolls back to the deploy before the running one", async () => {
    const directory = project();
    const folder = join(directory, BUNNY_DEPLOYS_DIR);
    mkdirSync(folder, { recursive: true });
    for (const [id, tag] of [
      ["20261105-090000-old1111", "old1111"],
      ["20261106-090000-abc1234", "abc1234"],
    ])
      writeFileSync(
        join(folder, `${id}.json`),
        JSON.stringify({ id, tag, commit: tag, createdAt: "2026-11-05T09:00:00Z" }),
      );
    const running = containers.map((item) =>
      item.imageNamespace === "12345" ? { ...item, imageTag: "abc1234" } : item,
    );
    const { calls, client } = fakeBunny(
      {
        "GET /mc/apps/app1": () => ({ status: "Running", containerTemplates: running }),
        "PATCH /mc/apps/app1/containers/c-backend": () => undefined,
        "PATCH /mc/apps/app1/containers/c-worker": () => undefined,
        "PATCH /mc/apps/app1/containers/c-frontend": () => undefined,
        "PATCH /mc/apps/app1/containers/c-proxy": () => undefined,
      },
      fakeRunner().run,
    );
    const id = await client.rollback({ ...link, directory });
    expect(id).toBe("20261106-100000-rollback");
    const patched = calls.filter((item) => item.method === "PATCH");
    expect(patched).toHaveLength(4);
    expect(patched.every((item) => (item.body as { imageTag: string }).imageTag === "old1111")).toBe(true);
    const record = JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8"));
    expect(record).toMatchObject({ tag: "old1111", rollbackOf: "20261105-090000-old1111" });
  });

  it("pushes each container's own variables", async () => {
    const directory = project();
    const { calls, client } = fakeBunny(
      {
        "GET /mc/apps/app1": () => ({ status: "Running", containerTemplates: containers }),
        ...Object.fromEntries(
          containers.map((item) => [`PUT /mc/apps/app1/containers/${item.id}/env`, () => undefined]),
        ),
      },
      fakeRunner().run,
    );
    await client.pushEnv({ ...link, directory }, { SITE_URL: "https://example.com" });
    const frontend = calls.find((item) => item.path === "/mc/apps/app1/containers/c-frontend/env");
    const body = frontend?.body as { environmentVariables: { name: string }[] } | undefined;
    const names = (body?.environmentVariables ?? []).map((item) => item.name);
    expect(names).toContain("API_URL");
    expect(names).not.toContain("DJANGO_SECRET_KEY");
  });

  it("shows the domain and whether its certificate is active", async () => {
    const { client } = fakeBunny(
      {
        "GET /mc/apps/app1": () => ({ status: "Running", containerTemplates: containers }),
        "GET /pullzone/777": () => ({
          Hostnames: [
            { Value: "site-mc.b-cdn.net", IsSystemHostname: true },
            { Value: "example.com", HasCertificate: false },
          ],
        }),
      },
      fakeRunner().run,
    );
    const status = await client.status(link);
    expect(status.state).toBe("running");
    expect(status.domains).toEqual(["https://example.com"]);
    expect(status.detail).toContain("no certificate for example.com");
  });
});

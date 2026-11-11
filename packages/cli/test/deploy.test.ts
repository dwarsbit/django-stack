import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Ask,
  appState,
  CoolifyClient,
  composeDomains,
  coolify,
  credentialsFile,
  type DeployLink,
  deleteToken,
  deploymentStatus,
  getToken,
  httpsRepository,
  insecureUrlWarning,
  lastTarget,
  normalizeUrl,
  PLATFORM_ENV,
  parseLog,
  readLink,
  rememberTarget,
  saveToken,
  setKeyring,
  uncommittedReason,
  unpushedReason,
  writeLink,
} from "../src/deploy";

const root = mkdtempSync(join(tmpdir(), "django-stack-deploy-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function tempDir(): string {
  const directory = join(root, Math.random().toString(36).slice(2));
  mkdirSync(directory, { recursive: true });
  return directory;
}

describe("insecureUrlWarning", () => {
  it("warns for http:// to another host only", () => {
    expect(insecureUrlWarning("http://203.0.113.5:8000")).toContain("unencrypted");
    expect(insecureUrlWarning("http://10.0.0.2:8000")).toContain("unencrypted");
    expect(insecureUrlWarning("https://coolify.example.com")).toBeUndefined();
    expect(insecureUrlWarning("http://localhost:8000")).toBeUndefined();
    expect(insecureUrlWarning("http://127.0.0.1:3000")).toBeUndefined();
  });
});

describe("normalizeUrl", () => {
  it("adds https and drops paths and slashes", () => {
    expect(normalizeUrl("coolify.example.com/")).toBe("https://coolify.example.com");
    expect(normalizeUrl("http://10.0.0.2:8000/projects")).toBe("http://10.0.0.2:8000");
  });
  it("refuses what is not a URL", () => {
    expect(() => normalizeUrl("http://")).toThrow(/not a URL/);
  });
});

describe("httpsRepository", () => {
  it.each([
    ["git@github.com:owner/site.git", "https://github.com/owner/site"],
    ["https://github.com/owner/site.git", "https://github.com/owner/site"],
    ["ssh://git@gitlab.com:22/group/site.git", "https://gitlab.com/group/site"],
    ["https://github.com/owner/site/", "https://github.com/owner/site"],
  ])("%s", (remote, expected) => {
    expect(httpsRepository(remote)).toBe(expected);
  });
});

describe("link file", () => {
  const link: DeployLink = {
    provider: "coolify",
    url: "https://coolify.example.com",
    project: "p1",
    environment: "e1",
    application: "a1",
  };

  it("round-trips", () => {
    const directory = tempDir();
    expect(readLink(directory)).toBeUndefined();
    writeLink(directory, { ...link, directory: "/elsewhere" });
    // The directory is not saved; reading adds the one it was read from.
    expect(readLink(directory)).toEqual({ ...link, directory });
  });

  it("refuses an incomplete file", () => {
    const directory = tempDir();
    mkdirSync(join(directory, ".dstack"));
    writeFileSync(join(directory, ".dstack/deploy.json"), JSON.stringify({ ...link, application: "" }));
    expect(() => readLink(directory)).toThrow(/no application/);
  });
});

describe("credentials", () => {
  const url = "https://coolify.example.com";
  let previousConfig: string | undefined;

  beforeEach(() => {
    previousConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempDir();
    delete process.env.DSTACK_TEST_TOKEN;
  });
  afterEach(() => {
    process.env.XDG_CONFIG_HOME = previousConfig;
    setKeyring(undefined);
  });

  it("uses the keychain when there is one", () => {
    const store = new Map<string, string>();
    setKeyring({
      get: (account) => store.get(account),
      set: (account, token) => void store.set(account, token),
      delete: (account) => void store.delete(account),
    });
    expect(saveToken("coolify", url, "secret")).toBe("keychain");
    expect(store.get(`coolify:${url}`)).toBe("secret");
    expect(getToken("coolify", url, "DSTACK_TEST_TOKEN")).toEqual({ token: "secret", source: "keychain" });
    expect(deleteToken("coolify", url)).toBe(true);
    expect(getToken("coolify", url, "DSTACK_TEST_TOKEN")).toBeUndefined();
  });

  it("falls back to a file only the user can read", () => {
    setKeyring({
      get: () => undefined,
      set: () => {
        throw new Error("Couldn't access platform storage");
      },
      delete: () => {},
    });
    expect(saveToken("coolify", url, "secret")).toBe("file");
    const file = credentialsFile();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ [`coolify:${url}`]: "secret" });
    expect(getToken("coolify", url, "DSTACK_TEST_TOKEN")?.source).toBe("file");
    expect(deleteToken("coolify", url)).toBe(true);
    expect(getToken("coolify", url, "DSTACK_TEST_TOKEN")).toBeUndefined();
  });

  it("remembers the last target of each provider", () => {
    expect(lastTarget("coolify")).toBeUndefined();
    rememberTarget("coolify", url);
    rememberTarget("dokploy", "https://dokploy.example.com");
    rememberTarget("coolify", "https://other.example.com");
    expect(lastTarget("coolify")).toBe("https://other.example.com");
    expect(lastTarget("dokploy")).toBe("https://dokploy.example.com");
    expect(existsSync(credentialsFile())).toBe(false);
  });

  it("lets the environment variable win", () => {
    setKeyring(null);
    saveToken("coolify", url, "saved");
    process.env.DSTACK_TEST_TOKEN = "from-env";
    expect(getToken("coolify", url, "DSTACK_TEST_TOKEN")).toEqual({ token: "from-env", source: "env" });
    delete process.env.DSTACK_TEST_TOKEN;
  });
});

describe("unpushedReason", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });

  it("checks that origin has the last commit", () => {
    const remote = tempDir();
    git(remote, "init", "--bare", "-b", "main");
    const work = tempDir();
    git(work, "init", "-b", "main");
    git(work, "remote", "add", "origin", remote);
    writeFileSync(join(work, "a"), "1");
    git(work, "add", ".");
    git(work, "commit", "-m", "one");
    expect(unpushedReason(work, "main")).toMatch(/origin has no branch main/);
    git(work, "push", "-u", "origin", "main");
    expect(unpushedReason(work, "main")).toBeUndefined();
    writeFileSync(join(work, "a"), "2");
    git(work, "commit", "-am", "two");
    expect(unpushedReason(work, "main")).toMatch(/not on origin\/main/);
  });
});

describe("uncommittedReason", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });

  it("checks that the tracked files are committed", () => {
    const work = tempDir();
    git(work, "init", "-b", "main");
    expect(uncommittedReason(work)).toMatch(/no commit yet/);
    writeFileSync(join(work, "a"), "1");
    git(work, "add", ".");
    git(work, "commit", "-m", "one");
    expect(uncommittedReason(work)).toBeUndefined();
    writeFileSync(join(work, "untracked"), "x");
    expect(uncommittedReason(work)).toBeUndefined();
    writeFileSync(join(work, "a"), "2");
    expect(uncommittedReason(work)).toMatch(/uncommitted changes/);
  });
});

describe("Coolify provider", () => {
  it("uses an API key and builds from the remote", () => {
    expect(coolify.auth.kind).toBe("token");
    expect(coolify.source).toBe("remote");
    expect(coolify.target.normalize("coolify.example.com/")).toBe("https://coolify.example.com");
    expect(() => coolify.connect("https://coolify.example.com")).toThrow(/API key/);
  });

  it("needs a repository to set up", async () => {
    const client = new CoolifyClient("https://coolify.example.com", "key", async () => {
      throw new Error("no request expected");
    });
    const ask = { interactive: false } as Ask;
    await expect(
      client.setup({
        ask,
        directory: ".",
        name: "site",
        branch: "main",
        domain: "example.com",
        env: {},
        options: {},
      }),
    ).rejects.toThrow(/--repository/);
  });
});

describe("Coolify mapping", () => {
  it("maps deployment states", () => {
    expect(deploymentStatus("queued")).toBe("queued");
    expect(deploymentStatus("in_progress")).toBe("building");
    expect(deploymentStatus("finished")).toBe("finished");
    expect(deploymentStatus("cancelled-by-user")).toBe("cancelled");
    expect(deploymentStatus("failed")).toBe("failed");
  });

  it("maps application states", () => {
    expect(appState("running:healthy")).toBe("running");
    expect(appState("running:unknown")).toBe("running");
    expect(appState("running:unhealthy")).toBe("degraded");
    expect(appState("degraded:unhealthy")).toBe("degraded");
    expect(appState("exited:unhealthy")).toBe("stopped");
    expect(appState(undefined)).toBe("unknown");
  });

  it("reads the log without hidden lines", () => {
    const logs = JSON.stringify([
      { output: "Cloning", type: "stdout", hidden: false },
      { output: "docker compose build --secret", type: "stdout", hidden: true },
      { output: "error: boom\nmore", type: "stderr", hidden: false },
    ]);
    expect(parseLog(logs)).toEqual([
      { text: "Cloning", stderr: false },
      { text: "error: boom", stderr: true },
      { text: "more", stderr: true },
    ]);
  });

  it("reads the domains of a Compose application", () => {
    expect(
      composeDomains({
        uuid: "a",
        name: "site",
        docker_compose_domains: JSON.stringify({ proxy: { domain: "https://example.com:80" }, backend: {} }),
      }),
    ).toEqual(["https://example.com"]);
  });
});

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** A fetch that answers from a table of "METHOD /path" entries. */
function fakeFetch(routes: Record<string, unknown | ((body: unknown) => unknown)>, calls: Call[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace(/^\/api\/v1/, "")}${url.search}`;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
    const route = routes[`${method} ${path}`];
    if (route === undefined) return new Response(JSON.stringify({ message: "Not found." }), { status: 404 });
    if (route instanceof Response) return route;
    const value = typeof route === "function" ? (route as (body: unknown) => unknown)(body) : route;
    return new Response(typeof value === "string" ? value : JSON.stringify(value), { status: 200 });
  }) as typeof fetch;
}

const quietAsk: Ask = {
  interactive: false,
  select: async (message, _choices, initial) => {
    if (initial === undefined) throw new Error(`asked: ${message}`);
    return initial;
  },
  text: async () => "",
  confirm: async (_message, initial = true) => initial,
  step: () => {},
};

describe("CoolifyClient", () => {
  const base = "https://coolify.example.com";
  const link: DeployLink = {
    provider: "coolify",
    url: base,
    project: "p1",
    environment: "e1",
    application: "a1",
  };

  it("creates the project, the application and the variables", async () => {
    const calls: Call[] = [];
    const client = new CoolifyClient(
      base,
      "token",
      fakeFetch(
        {
          "GET /servers": [{ uuid: "s1", name: "localhost", ip: "host.docker.internal" }],
          "GET /projects": [{ uuid: "other", name: "other" }],
          "POST /projects": { uuid: "p1" },
          "GET /projects/p1/environments": [{ uuid: "e1", name: "production" }],
          "POST /applications/public": { uuid: "a1" },
          "PATCH /applications/a1/envs/bulk": { message: "ok" },
        },
        calls,
      ),
    );
    const ids = await client.setup({
      ask: quietAsk,
      directory: ".",
      name: "site",
      repository: "https://github.com/owner/site",
      branch: "main",
      domain: "example.com",
      env: { COMPOSE_PROFILES: "prod,db", ...PLATFORM_ENV },
      options: {},
    });
    expect(ids).toEqual({ project: "p1", environment: "e1", application: "a1" });
    const app = calls.find((call) => call.path === "/applications/public")?.body as Record<string, unknown>;
    expect(app).toMatchObject({
      project_uuid: "p1",
      server_uuid: "s1",
      environment_uuid: "e1",
      git_repository: "https://github.com/owner/site",
      git_branch: "main",
      build_pack: "dockercompose",
      docker_compose_location: "/compose.yaml",
      docker_compose_domains: [{ name: "proxy", domain: "https://example.com:80" }],
      instant_deploy: false,
      is_preserve_repository_enabled: true,
    });
    const env = calls.find((call) => call.path.endsWith("/envs/bulk"))?.body as { data: { key: string }[] };
    expect(env.data.map((item) => item.key)).toContain("CADDY_ADDRESS");
    expect(env.data.every((item) => (item as { is_literal?: boolean }).is_literal)).toBe(true);
  });

  it("uses a GitHub App for a private repository", async () => {
    const calls: Call[] = [];
    const client = new CoolifyClient(
      base,
      "token",
      fakeFetch(
        {
          "GET /servers": [{ uuid: "s1", name: "main" }],
          "GET /projects": [{ uuid: "p1", name: "site" }],
          "GET /projects/p1/environments": [],
          "POST /projects/p1/environments": { uuid: "e2" },
          "GET /github-apps": [{ uuid: "g1", name: "acme" }],
          "POST /applications/private-github-app": { uuid: "a2" },
          "PATCH /applications/a2/envs/bulk": {},
        },
        calls,
      ),
    );
    const ids = await client.setup({
      ask: quietAsk,
      directory: ".",
      name: "site",
      repository: "https://github.com/owner/site",
      branch: "main",
      domain: "example.com",
      env: {},
      options: { githubApp: "acme", environment: "staging" },
    });
    expect(ids).toEqual({ project: "p1", environment: "e2", application: "a2" });
    expect(
      calls.find((call) => call.path === "/projects/p1/environments" && call.method === "POST")?.body,
    ).toEqual({
      name: "staging",
    });
    expect(calls.find((call) => call.path === "/applications/private-github-app")?.body).toMatchObject({
      github_app_uuid: "g1",
    });
  });

  it("asks for the server when there are several", async () => {
    const client = new CoolifyClient(
      base,
      "token",
      fakeFetch(
        {
          "GET /servers": [
            { uuid: "s1", name: "a" },
            { uuid: "s2", name: "b" },
          ],
        },
        [],
      ),
    );
    await expect(
      client.setup({
        ask: quietAsk,
        directory: ".",
        name: "site",
        repository: "r",
        branch: "main",
        domain: "example.com",
        env: {},
        options: {},
      }),
    ).rejects.toThrow(/Server to deploy to/);
  });

  it("deploys and reads the deployment", async () => {
    const calls: Call[] = [];
    const client = new CoolifyClient(
      base,
      "token",
      fakeFetch(
        {
          "PATCH /applications/a1": { uuid: "a1" },
          "POST /deploy?uuid=a1&force=true": {
            deployments: [{ message: "queued", resource_uuid: "a1", deployment_uuid: "d1" }],
          },
          "GET /deployments/d1": {
            deployment_uuid: "d1",
            status: "in_progress",
            commit: "0123456789abcdef",
            commit_message: "Add a page\n\nbody",
            deployment_url: "/project/p1/environment/e1/application/a1/deployment/d1",
            logs: JSON.stringify([{ output: "Building", type: "stdout", hidden: false }]),
          },
          "GET /deployments/applications/a1?take=5": {
            count: 1,
            deployments: [{ deployment_uuid: "d1", status: "finished" }],
          },
          "GET /applications/a1": {
            uuid: "a1",
            name: "site",
            status: "running:healthy",
            git_branch: "main",
            docker_compose_domains: { proxy: { domain: "https://example.com:80" } },
          },
        },
        calls,
      ),
    );
    expect(await client.deploy(link, { force: true })).toBe("d1");
    expect(calls.find((call) => call.method === "PATCH" && call.path === "/applications/a1")?.body).toEqual({
      is_preserve_repository_enabled: true,
    });
    expect(await client.deployment(link, "d1")).toMatchObject({
      id: "d1",
      status: "building",
      commit: "0123456",
      message: "Add a page",
      url: `${base}/project/p1/environment/e1/application/a1/deployment/d1`,
      log: [{ text: "Building", stderr: false }],
    });
    expect((await client.deployments(link, 5)).map((item) => item.status)).toEqual(["finished"]);
    expect(await client.status(link)).toMatchObject({
      state: "running",
      domains: ["https://example.com"],
      branch: "main",
      url: `${base}/project/p1/environment/e1/application/a1`,
    });
  });

  it("explains a rejected key", async () => {
    const client = new CoolifyClient(
      base,
      "token",
      fakeFetch({ "GET /version": new Response('{"message":"Unauthenticated."}', { status: 401 }) }, []),
    );
    await expect(client.verify()).rejects.toThrow(/rejected the API key/);
  });
});

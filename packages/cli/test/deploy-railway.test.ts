import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Ask,
  type CommandRunner,
  type ComposeProject,
  commandWord,
  githubRepository,
  groupStatus,
  lastStage,
  planRailway,
  RailwayClient,
  railway,
  railwayDeploymentStatus,
  railwayHosts,
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

const DOCKERFILE = "FROM python:3.13-slim AS base\nFROM base AS dev\nFROM base AS prod\n";

function fixture(): ComposeProject {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/bunny-compose.json"), "utf8")) as ComposeProject;
}

const readFile = (path: string) => {
  if (path === "/project/Caddyfile") return CADDYFILE;
  if (path.endsWith("/Dockerfile")) return DOCKERFILE;
  throw new Error("not a file");
};

const options = { directory: "/project", readFile };

describe("Compose to Railway", () => {
  it("reads helpers", () => {
    expect(railwayHosts("postgres://app:pw@db:5432/app", { db: "db" })).toBe(
      "postgres://app:pw@db.railway.internal:5432/app",
    );
    expect(railwayHosts("http://mydb:5432 db.example.com:5432", { db: "db" })).toBe(
      "http://mydb:5432 db.example.com:5432",
    );
    expect(lastStage(DOCKERFILE)).toBe("prod");
    expect(lastStage("FROM node:22\n")).toBe("");
    expect(commandWord("run_huey")).toBe("run_huey");
    expect(commandWord("a b")).toBe("'a b'");
    expect(githubRepository("https://github.com/owner/site")).toBe("owner/site");
    expect(() => githubRepository("https://gitlab.com/owner/site")).toThrow(/GitHub/);
  });

  it("plans one service per production service", () => {
    const plan = planRailway(fixture(), options);
    const byName = Object.fromEntries(plan.services.map((item) => [item.name, item]));
    expect(Object.keys(byName).sort()).toEqual(["backend", "cache", "db", "frontend", "proxy", "worker"]);

    expect(byName.backend?.source).toEqual({ kind: "repo", rootDirectory: "/backend" });
    expect(byName.backend?.watchPatterns).toEqual(["/backend/**"]);
    expect(byName.backend?.port).toBe(8000);
    expect(byName.backend?.env.PORT).toBe("8000");
    expect(byName.backend?.healthcheckPath).toBe("/readyz");
    expect(byName.backend?.env.DATABASE_URL).toBe(
      "postgres://app:test-postgres-password@db.railway.internal:5432/app",
    );
    expect(byName.backend?.env.CACHE_URL).toBe("redis://cache.railway.internal:6379/0");
    expect(byName.backend?.env.COMPOSE_PROFILES).toBeUndefined();
    expect(byName.backend?.volume).toBeUndefined();

    expect(byName.worker?.startCommand).toBe("python manage.py run_huey");
    expect(byName.worker?.volume).toBeUndefined();
    expect(byName.frontend?.source).toEqual({ kind: "repo", rootDirectory: "/frontend" });
    expect(byName.frontend?.env.PORT).toBe("3000");

    // Railway's Postgres image, with the data in a directory of the volume.
    expect(byName.db?.source).toEqual({
      kind: "image",
      image: "ghcr.io/railwayapp-templates/postgres-ssl:17",
    });
    expect(byName.db?.volume).toBe("/var/lib/postgresql/data");
    expect(byName.db?.env.PGDATA).toBe("/var/lib/postgresql/data/pgdata");

    // The Caddyfile goes in a variable, with the private host names.
    expect(byName.proxy?.public).toBe(true);
    expect(byName.proxy?.port).toBe(80);
    expect(byName.proxy?.env.DSTACK_FILE_CADDYFILE).toContain("reverse_proxy backend.railway.internal:8000");
    expect(byName.proxy?.env.DSTACK_FILE_CADDYFILE).toContain("reverse_proxy frontend.railway.internal:3000");
    expect(byName.proxy?.startCommand).toBe(
      `/bin/sh -c 'printf %s "$DSTACK_FILE_CADDYFILE" > /etc/caddy/Caddyfile && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile'`,
    );
    expect(byName.proxy?.volume).toBeUndefined();
    expect(plan.services.filter((item) => item.public)).toHaveLength(1);
    expect(plan.ignored).toContain("read_only");
  });

  it("needs S3 for uploads", () => {
    const project = fixture();
    for (const service of Object.values(project.services))
      if (service.environment) service.environment.S3_BUCKET = "";
    expect(() => planRailway(project, options)).toThrow(/Uploads must be in S3/);
  });

  it("skips services scaled to 0", () => {
    const project = fixture();
    (project.services["worker-prod"] as { deploy: unknown }).deploy = { replicas: 0 };
    expect(planRailway(project, options).services.map((item) => item.name)).not.toContain("worker");
  });

  it("refuses a build target that is not the last stage", () => {
    const project = fixture();
    const backend = project.services["backend-prod"];
    if (backend?.build) backend.build.target = "dev";
    expect(() => planRailway(project, options)).toThrow(/last stage only/);
  });

  it("maps deployment states", () => {
    expect(railwayDeploymentStatus("SUCCESS")).toBe("finished");
    expect(railwayDeploymentStatus("REMOVED")).toBe("finished");
    expect(railwayDeploymentStatus("BUILDING")).toBe("building");
    expect(railwayDeploymentStatus("QUEUED")).toBe("queued");
    expect(railwayDeploymentStatus("CRASHED")).toBe("failed");
    expect(groupStatus(["finished", "building"])).toBe("building");
    expect(groupStatus(["finished", "failed", "building"])).toBe("failed");
    expect(groupStatus(["finished", "finished"])).toBe("finished");
  });
});

type Handler = (variables: Record<string, unknown>) => unknown;

/** A fake Railway API: a handler per top-level field, and a log of the calls. */
function fakeRailway(handlers: Record<string, Handler>) {
  const calls: { field: string; variables: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (_input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const field = body.query.match(/^\s*(?:query|mutation)[^{]*\{\s*(\w+)/)?.[1] ?? "";
    calls.push({ field, variables: body.variables, headers: init.headers as Record<string, string> });
    const handler = handlers[field];
    if (!handler)
      return new Response(JSON.stringify({ errors: [{ message: `No ${field}` }] }), { status: 200 });
    return new Response(JSON.stringify({ data: { [field]: handler(body.variables) } }), { status: 200 });
  }) as unknown as typeof fetch;
  const run: CommandRunner = async () => ({ code: 0, stdout: JSON.stringify(fixture()), stderr: "" });
  const client = new RailwayClient("token", fetchImpl, { run, readFile });
  client.pollMs = 0;
  return { calls, client };
}

const ask = { interactive: false, step: () => {} } as unknown as Ask;
const link = {
  provider: "railway",
  url: "https://backboard.railway.com/graphql/v2",
  project: "p1",
  environment: "e1",
  application: "s-proxy",
  directory: "/project",
};

function instance(name: string, repo: boolean, status = "SUCCESS") {
  return {
    serviceId: `s-${name}`,
    serviceName: name,
    source: repo ? { repo: "owner/site", image: null } : { repo: null, image: "caddy:2.11-alpine" },
    latestDeployment: { id: `d-${name}`, status, meta: { branch: "main" } },
    domains: name === "proxy" ? { customDomains: [{ domain: "example.com" }], serviceDomains: [] } : null,
  };
}

function project(instances: ReturnType<typeof instance>[], services: string[] = []) {
  return {
    id: "p1",
    name: "site",
    services: { edges: services.map((name) => ({ node: { id: `s-${name}`, name } })) },
    environments: {
      edges: [
        {
          node: {
            id: "e1",
            name: "production",
            serviceInstances: { edges: instances.map((node) => ({ node })) },
          },
        },
      ],
    },
  };
}

describe("Railway client", () => {
  it("is a token provider with a fixed API", () => {
    expect(railway.auth.kind).toBe("token");
    expect(railway.source).toBe("remote");
    expect(railway.target.fixed).toBe("https://backboard.railway.com/graphql/v2");
    expect(railway.platformEnv.CADDY_ADDRESS).toBe(":80");
  });

  it("sets up a project with one service per production service", async () => {
    let next = 0;
    const { calls, client } = fakeRailway({
      me: () => ({ workspaces: [{ id: "w1", name: "Mine" }] }),
      projectCreate: () => ({ id: "p1" }),
      project: () => project([]),
      serviceCreate: (variables) => {
        next++;
        return { id: `s${next}-${(variables.input as { name: string }).name}` };
      },
      variableCollectionUpsert: () => true,
      serviceInstanceUpdate: () => true,
      volumeCreate: () => ({ id: "v1" }),
      serviceConnect: () => ({ id: "x" }),
      customDomainCreate: () => ({
        status: {
          dnsRecords: [
            { fqdn: "example.com", recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "abc.up.railway.app" },
          ],
        },
      }),
    });
    const steps: string[] = [];
    const ids = await client.setup({
      ask: { ...ask, step: (message: string) => steps.push(message) },
      directory: "/project",
      name: "site",
      repository: "https://github.com/owner/site",
      branch: "main",
      domain: "example.com",
      env: {},
      options: {},
    });
    expect(ids.project).toBe("p1");
    expect(ids.environment).toBe("e1");
    expect(ids.application).toMatch(/-proxy$/);
    expect(calls[0]?.headers.Authorization).toBe("Bearer token");

    const created = calls.filter((call) => call.field === "serviceCreate");
    expect(created).toHaveLength(6);
    const connects = calls
      .filter((call) => call.field === "serviceConnect")
      .map((call) => call.variables.input);
    expect(connects).toContainEqual({ repo: "owner/site", branch: "main" });
    expect(connects).toContainEqual({ image: "ghcr.io/railwayapp-templates/postgres-ssl:17" });
    const volumes = calls.filter((call) => call.field === "volumeCreate");
    expect(volumes).toHaveLength(1);
    expect((volumes[0]?.variables.input as { mountPath?: string } | undefined)?.mountPath).toBe(
      "/var/lib/postgresql/data",
    );
    // The source is connected after the variables and settings, since it starts a deploy.
    const fields = calls.map((call) => call.field);
    expect(fields.indexOf("serviceConnect")).toBeGreaterThan(fields.indexOf("serviceInstanceUpdate"));
    const domain = calls.find((call) => call.field === "customDomainCreate")?.variables.input;
    expect(domain).toMatchObject({ domain: "example.com", targetPort: 80, serviceId: ids.application });
    expect(steps).toContain("Add this DNS record: example.com CNAME abc.up.railway.app");
  });

  it("refuses a project that already has the services", async () => {
    const { client } = fakeRailway({
      me: () => ({
        workspaces: [{ id: "w1", name: "Mine", projects: { edges: [{ node: { id: "p1", name: "site" } }] } }],
      }),
      project: () => project([], ["backend"]),
    });
    await expect(
      client.setup({
        ask,
        directory: "/project",
        name: "site",
        repository: "https://github.com/owner/site",
        branch: "main",
        domain: "example.com",
        env: {},
        options: { project: "site" },
      }),
    ).rejects.toThrow(/already has a service backend/);
  });

  it("deploys the services built from the repository", async () => {
    const { calls, client } = fakeRailway({
      project: () =>
        project([instance("backend", true), instance("frontend", true), instance("proxy", false)]),
      serviceInstanceDeployV2: (variables) => `new-${variables.serviceId}`,
    });
    expect(await client.deploy(link)).toBe("new-s-backend");
    expect(
      calls
        .filter((call) => call.field === "serviceInstanceDeployV2")
        .map((call) => call.variables.serviceId),
    ).toEqual(["s-backend", "s-frontend"]);
  });

  it("groups the deployments of one commit", async () => {
    const deployments: Record<string, unknown[]> = {
      "s-backend": [
        {
          id: "b2",
          status: "BUILDING",
          createdAt: "2026-11-06T10:00:00Z",
          meta: { commitHash: "bbbbbbb2", commitMessage: "Second" },
        },
        { id: "b1", status: "REMOVED", createdAt: "2026-11-05T10:00:00Z", meta: { commitHash: "aaaaaaa1" } },
      ],
      "s-frontend": [
        { id: "f2", status: "FAILED", createdAt: "2026-11-06T10:00:01Z", meta: { commitHash: "bbbbbbb2" } },
        { id: "f1", status: "REMOVED", createdAt: "2026-11-05T10:00:01Z", meta: { commitHash: "aaaaaaa1" } },
      ],
    };
    const { client } = fakeRailway({
      project: () =>
        project([instance("backend", true), instance("frontend", true), instance("proxy", false)]),
      deployments: (variables) => ({
        edges: (deployments[(variables.input as { serviceId: string }).serviceId] ?? []).map((node) => ({
          node,
        })),
      }),
      buildLogs: () => [{ message: "Step 1", severity: "info" }],
      deploymentLogs: () => [],
    });
    const list = await client.deployments(link, 5);
    expect(list.map((item) => [item.id, item.status, item.commit])).toEqual([
      ["b2", "failed", "bbbbbbb"],
      ["b1", "finished", "aaaaaaa"],
    ]);
    expect(list[0]?.message).toBe("Second");
    const one = await client.deployment(link, "b2");
    expect(one.log.map((line) => line.text)).toEqual(["backend | Step 1", "frontend | Step 1"]);
  });

  it("rolls back every built service to the deploy before the running one", async () => {
    const deployments: Record<string, unknown[]> = {
      "s-backend": [
        { id: "b2", status: "SUCCESS", createdAt: "2026-11-06T10:00:00Z", meta: { commitHash: "c2" } },
        { id: "b1", status: "REMOVED", createdAt: "2026-11-05T10:00:00Z", meta: { commitHash: "c1" } },
      ],
      "s-frontend": [
        { id: "f2", status: "SUCCESS", createdAt: "2026-11-06T10:00:01Z", meta: { commitHash: "c2" } },
        { id: "f1", status: "REMOVED", createdAt: "2026-11-05T10:00:01Z", meta: { commitHash: "c1" } },
      ],
    };
    const { calls, client } = fakeRailway({
      project: () => project([instance("backend", true), instance("frontend", true)]),
      deployments: (variables) => ({
        edges: (deployments[(variables.input as { serviceId: string }).serviceId] ?? []).map((node) => ({
          node,
        })),
      }),
      deploymentRollback: (variables) => {
        if (variables.id === "b1")
          deployments["s-backend"]?.unshift({
            id: "b3",
            status: "QUEUED",
            createdAt: "2026-11-06T11:00:00Z",
            meta: { commitHash: "c1" },
          });
        return true;
      },
    });
    expect(await client.rollback(link)).toBe("b3");
    expect(
      calls.filter((call) => call.field === "deploymentRollback").map((call) => call.variables.id),
    ).toEqual(["b1", "f1"]);
  });

  it("reads the status of the services", async () => {
    const { client } = fakeRailway({
      project: () =>
        project([instance("backend", true), instance("frontend", true, "CRASHED"), instance("proxy", false)]),
    });
    const status = await client.status(link);
    expect(status.state).toBe("degraded");
    expect(status.domains).toEqual(["https://example.com"]);
    expect(status.branch).toBe("main");
    expect(status.detail).toContain("frontend:crashed");
  });

  it("reports a refused token in one line", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "Not Authorized" }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(new RailwayClient("bad", fetchImpl).verify()).rejects.toThrow(/refused the token/);
  });
});

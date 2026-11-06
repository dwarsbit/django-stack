import { describe, expect, it } from "vitest";
import {
  type Ask,
  DokployClient,
  dokploy,
  dokployAppState,
  dokployDeploymentStatus,
  envText,
  PLATFORM_ENV,
} from "../src/deploy";

type Handler = (body: Record<string, unknown> | undefined, query: URLSearchParams) => unknown;

/** A fake Dokploy API: a handler per procedure, and a log of the calls. */
function fakeDokploy(handlers: Record<string, Handler>) {
  const calls: {
    procedure: string;
    method: string;
    body?: Record<string, unknown>;
    headers: Record<string, string>;
  }[] = [];
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const procedure = url.pathname.replace(/^\/api\//, "");
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({
      procedure,
      method: String(init.method),
      body,
      headers: init.headers as Record<string, string>,
    });
    const handler = handlers[procedure];
    if (!handler) return new Response(JSON.stringify({ message: `No ${procedure}` }), { status: 404 });
    const result = handler(body, url.searchParams);
    if (result instanceof Response) return result;
    return new Response(result === undefined ? "" : JSON.stringify(result), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, client: new DokployClient("https://dokploy.example.com", "key", fetchImpl) };
}

const ask = { interactive: false, step: () => {} } as unknown as Ask;
const link = {
  provider: "dokploy",
  url: "https://dokploy.example.com",
  project: "p1",
  environment: "e1",
  application: "c1",
};

describe("Dokploy mapping", () => {
  it("maps deployment and service states", () => {
    expect(dokployDeploymentStatus("done")).toBe("finished");
    expect(dokployDeploymentStatus("running")).toBe("building");
    expect(dokployDeploymentStatus("error")).toBe("failed");
    expect(dokployDeploymentStatus("cancelled")).toBe("cancelled");
    expect(dokployAppState("done")).toBe("running");
    expect(dokployAppState("error")).toBe("degraded");
    expect(dokployAppState("idle")).toBe("stopped");
    expect(dokployAppState("running")).toBe("unknown");
  });

  it("writes the variables as .env text", () => {
    expect(envText({ A: "1", FROM: "Site <noreply@example.com>" })).toBe(
      "A=1\nFROM='Site <noreply@example.com>'",
    );
  });

  it("is a token provider that builds from the remote", () => {
    expect(dokploy.auth.kind).toBe("token");
    expect(dokploy.source).toBe("remote");
    expect(dokploy.platformEnv).toEqual(PLATFORM_ENV);
    expect(dokploy.target.normalize("dokploy.example.com/")).toBe("https://dokploy.example.com");
  });
});

describe("DokployClient", () => {
  it("sends the API key and reads the version", async () => {
    const { calls, client } = fakeDokploy({
      "project.all": () => [],
      "settings.getDokployVersion": () => "v0.25.6",
    });
    expect(await client.verify()).toBe("v0.25.6");
    expect(calls[0]?.headers["x-api-key"]).toBe("key");
  });

  it("explains a rejected key", async () => {
    const { client } = fakeDokploy({ "project.all": () => new Response("{}", { status: 401 }) });
    await expect(client.verify()).rejects.toThrow(/rejected the API key/);
  });

  it("creates the project, the compose service and the domain", async () => {
    const { calls, client } = fakeDokploy({
      "server.all": () => [],
      "project.all": () => [],
      "project.create": () => ({
        project: { projectId: "p1", name: "site" },
        environment: { environmentId: "e1" },
      }),
      "environment.byProjectId": () => [{ environmentId: "e1", name: "production" }],
      "compose.create": () => ({ composeId: "c1", name: "site" }),
      "compose.update": () => true,
      "domain.byComposeId": () => [],
      "domain.create": () => ({ domainId: "d1" }),
    });
    const ids = await client.setup({
      ask,
      directory: ".",
      name: "site",
      repository: "https://github.com/you/site",
      branch: "main",
      domain: "example.com",
      env: { SITE_URL: "https://example.com", CADDY_ADDRESS: ":80" },
      options: {},
    });
    expect(ids).toEqual({ project: "p1", environment: "e1", application: "c1" });
    const body = (procedure: string) => calls.find((call) => call.procedure === procedure)?.body;
    expect(body("compose.create")).toMatchObject({
      name: "site",
      environmentId: "e1",
      composeType: "docker-compose",
    });
    expect(body("compose.update")).toMatchObject({
      composeId: "c1",
      sourceType: "git",
      customGitUrl: "https://github.com/you/site",
      customGitBranch: "main",
      composePath: "./compose.yaml",
      env: "SITE_URL=https://example.com\nCADDY_ADDRESS=:80",
    });
    expect(body("domain.create")).toMatchObject({
      host: "example.com",
      port: 80,
      https: true,
      certificateType: "letsencrypt",
      composeId: "c1",
      serviceName: "proxy",
      domainType: "compose",
    });
  });

  it("needs a repository", async () => {
    const { client } = fakeDokploy({});
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

  it("returns the new deployment of a deploy", async () => {
    let deployed = false;
    const { client } = fakeDokploy({
      "deployment.allByCompose": () => [
        ...(deployed ? [{ deploymentId: "new", status: "running", createdAt: "2026-11-05T10:00:00Z" }] : []),
        { deploymentId: "old", status: "done", createdAt: "2026-11-04T10:00:00Z" },
      ],
      "compose.deploy": () => {
        deployed = true;
        return true;
      },
    });
    client.pollMs = 0;
    expect(await client.deploy(link)).toBe("new");
    const deployment = await client.deployment(link, "new");
    expect(deployment.status).toBe("building");
    expect(deployment.log.at(-1)?.text).toContain("/services/compose/c1");
    expect((await client.deployments(link, 5)).map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("reads the status of the service", async () => {
    const { client } = fakeDokploy({
      "compose.one": () => ({
        composeId: "c1",
        name: "site",
        composeStatus: "done",
        customGitBranch: "main",
        domains: [{ host: "example.com", https: true }],
      }),
    });
    expect(await client.status(link)).toMatchObject({
      state: "running",
      detail: "done",
      domains: ["https://example.com"],
      branch: "main",
    });
  });
});

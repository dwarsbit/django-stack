import type {
  AppState,
  AppStatus,
  DeployLink,
  Deployment,
  DeploymentStatus,
  DeployProvider,
  LogLine,
  ProviderClient,
  SetupContext,
} from "./provider";
import { urlTarget } from "./provider";

/**
 * Coolify (https://coolify.io), through its API at /api/v1 with a bearer
 * token. The project deploys as a Docker Compose application that Coolify
 * builds on the server from the git repository; Coolify's proxy gets the
 * certificate and forwards to the `proxy` service (Caddy) on port 80.
 */

/** Variables that put Caddy behind Coolify's proxy. See the docs page on platforms. */
export const PLATFORM_ENV: Record<string, string> = {
  CADDY_ADDRESS: ":80",
  TRUSTED_PROXIES: "private_ranges",
  NUM_PROXIES: "2",
  HTTP_PORT: "127.0.0.1:8080",
  HTTPS_PORT: "127.0.0.1:8443",
};

export type Fetch = typeof fetch;

/** Setup flags Coolify and Dokploy share; `deploy setup` shows each flag once. */
export const SHARED_SETUP_FLAGS = [
  { name: "server", description: "The server on the platform, by name or id (Dokploy: dokploy for its own)" },
  { name: "project", description: "The platform's project, by name or id (default: the project name)" },
  { name: "environment", description: "The platform's environment (default: production)" },
];

interface Named {
  uuid: string;
  name: string;
  description?: string | null;
}

interface CoolifyServer extends Named {
  ip?: string;
  is_reachable?: boolean;
  settings?: { is_reachable?: boolean; is_usable?: boolean };
}

interface CoolifyApplication extends Named {
  status?: string;
  git_branch?: string;
  fqdn?: string | null;
  docker_compose_domains?: string | Record<string, { domain?: string }> | null;
  environment?: { uuid?: string; project?: { uuid?: string } };
}

interface CoolifyDeployment {
  deployment_uuid: string;
  status: string;
  commit?: string | null;
  commit_message?: string | null;
  created_at?: string;
  updated_at?: string;
  deployment_url?: string | null;
  logs?: string | null;
}

export class CoolifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class CoolifyApi {
  constructor(
    readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new CoolifyError(`Could not reach Coolify at ${this.url}: ${(error as Error).message}`, 0);
    }
    const text = await response.text();
    if (!response.ok) throw new CoolifyError(errorMessage(response.status, text, this.url), response.status);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body?: unknown) => this.request<T>("POST", path, body ?? {});
  patch = <T>(path: string, body: unknown) => this.request<T>("PATCH", path, body);
}

function errorMessage(status: number, text: string, url: string): string {
  if (status === 401)
    return `Coolify at ${url} rejected the API key. Run dstack deploy login to enter a new one.`;
  if (status === 403)
    return "The API key may not do this. Give it the read, write and deploy permissions in Coolify under Keys & Tokens.";
  if (status === 404 && text.includes("<html")) return `${url} does not answer like Coolify; check the URL.`;
  let message = "";
  try {
    const body = JSON.parse(text) as { message?: string; errors?: Record<string, string[]> };
    message = body.message ?? "";
    if (body.errors) message += ` ${Object.values(body.errors).flat().join(" ")}`;
  } catch {
    message = text.slice(0, 200);
  }
  return `Coolify answered ${status}${message ? `: ${message.trim()}` : "."}`;
}

const enc = encodeURIComponent;

export function deploymentStatus(value: string): DeploymentStatus {
  if (value === "queued") return "queued";
  if (value === "in_progress") return "building";
  if (value === "finished") return "finished";
  if (value.startsWith("cancelled")) return "cancelled";
  return "failed";
}

export function appState(value: string | undefined): AppState {
  const [state = "", health = ""] = (value ?? "").split(/[:(]/);
  if (state === "running") return health.startsWith("unhealthy") ? "degraded" : "running";
  if (state === "degraded" || state === "restarting") return "degraded";
  if (state === "exited" || state === "stopped") return "stopped";
  return "unknown";
}

/** Coolify keeps the log as JSON text: a list of { output, type, hidden }. */
export function parseLog(logs: string | null | undefined): LogLine[] {
  if (!logs) return [];
  let entries: { output?: string; type?: string; hidden?: boolean }[];
  try {
    entries = JSON.parse(logs);
  } catch {
    return logs.split("\n").map((text) => ({ text, stderr: false }));
  }
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => !entry.hidden && entry.output)
    .flatMap((entry) =>
      String(entry.output)
        .split("\n")
        .map((text) => ({ text, stderr: entry.type === "stderr" })),
    );
}

/** The domains of a Compose application, by service. */
export function composeDomains(app: CoolifyApplication): string[] {
  let value = app.docker_compose_domains;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as Record<string, { domain?: string }>;
    } catch {
      value = null;
    }
  }
  const domains = Object.values(value ?? {})
    .flatMap((service) => (service?.domain ?? "").split(","))
    .map((domain) => domain.trim())
    .filter(Boolean);
  if (!domains.length && app.fqdn) domains.push(...app.fqdn.split(",").map((d) => d.trim()));
  // Drop the internal port: https://example.com:80 is served at https://example.com.
  return domains.map((domain) => domain.replace(/:\d+$/, ""));
}

function appUrl(api: CoolifyApi, link: DeployLink): string {
  return `${api.url}/project/${link.project}/environment/${link.environment}/application/${link.application}`;
}

function toDeployment(api: CoolifyApi, link: DeployLink, item: CoolifyDeployment): Deployment {
  const path = item.deployment_url;
  return {
    id: item.deployment_uuid,
    status: deploymentStatus(item.status),
    commit: item.commit && item.commit !== "HEAD" ? item.commit.slice(0, 7) : undefined,
    message: item.commit_message?.split("\n")[0] || undefined,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    url: path
      ? `${api.url}${path.startsWith("/") ? "" : "/"}${path}`
      : `${appUrl(api, link)}/deployment/${item.deployment_uuid}`,
    log: parseLog(item.logs),
  };
}

/** Finds a name or uuid in a list. */
function find<T extends Named>(items: T[], wanted: string): T | undefined {
  return items.find((item) => item.uuid === wanted) ?? items.find((item) => item.name === wanted);
}

export class CoolifyClient implements ProviderClient {
  readonly api: CoolifyApi;

  constructor(url: string, token: string, fetchImpl?: Fetch) {
    this.api = new CoolifyApi(url, token, fetchImpl);
  }

  async verify(): Promise<string> {
    const version = await this.api.get<string>("/version");
    // A token for another team or without read access still gets the version; this one needs read.
    await this.api.get("/servers");
    return String(version).trim();
  }

  async setup(context: SetupContext) {
    const { ask, options } = context;
    if (!context.repository) throw new Error("Coolify builds from a git repository; pass --repository.");
    const api = this.api;

    const servers = await api.get<CoolifyServer[]>("/servers");
    if (!servers.length) throw new Error("This Coolify has no servers. Add one in Coolify first.");
    let server: CoolifyServer | undefined;
    if (options.server) {
      server = find(servers, options.server);
      if (!server) throw new Error(`Coolify has no server ${options.server}.`);
    } else if (servers.length === 1) {
      server = servers[0];
    } else {
      const uuid = await ask.select(
        "Server to deploy to",
        servers.map((item) => ({ value: item.uuid, label: item.name, hint: item.ip })),
      );
      server = find(servers, uuid);
    }
    if (!server) throw new Error("No server chosen.");

    const projects = await api.get<Named[]>("/projects");
    let project: Named | undefined;
    const projectName = options.project ?? context.name;
    project = find(projects, projectName);
    if (!options.project && ask.interactive && projects.length) {
      const NEW = "";
      const uuid = await ask.select(
        "Coolify project",
        [
          ...(project ? [] : [{ value: NEW, label: `Create ${projectName}` }]),
          ...projects.map((item) => ({
            value: item.uuid,
            label: item.name,
            hint: item.description ?? undefined,
          })),
        ],
        project?.uuid ?? NEW,
      );
      project = uuid === NEW ? undefined : find(projects, uuid);
    }
    if (!project) {
      if (options.project && /^[a-z0-9]{20,}$/.test(options.project))
        throw new Error(`Coolify has no project ${options.project}.`);
      const created = await api.post<{ uuid: string }>("/projects", {
        name: projectName,
        description: "DjangoStack",
      });
      project = { uuid: created.uuid, name: projectName };
      ask.step(`Created the Coolify project ${projectName}`);
    }

    const environmentName = options.environment ?? "production";
    const environments = await api.get<Named[]>(`/projects/${enc(project.uuid)}/environments`);
    let environment = find(environments, environmentName);
    if (!environment) {
      const created = await api.post<{ uuid: string }>(`/projects/${enc(project.uuid)}/environments`, {
        name: environmentName,
      });
      environment = { uuid: created.uuid, name: environmentName };
      ask.step(`Created the environment ${environmentName}`);
    }

    // Public repositories need nothing; private ones go through a GitHub App set up in Coolify.
    let githubApp: string | undefined;
    if (options.githubApp && options.githubApp !== "public") {
      const apps = await api.get<Named[]>("/github-apps");
      const app = find(apps, options.githubApp);
      if (!app) throw new Error(`Coolify has no GitHub App ${options.githubApp}.`);
      githubApp = app.uuid;
    } else if (!options.githubApp && ask.interactive) {
      const apps = (await api.get<Named[]>("/github-apps").catch(() => [] as Named[])).filter(
        (app) => app.uuid && app.name,
      );
      if (apps.length) {
        const choice = await ask.select(
          "How Coolify gets the code",
          [
            { value: "public", label: "Public repository", hint: "no access needed" },
            ...apps.map((app) => ({
              value: app.uuid,
              label: `GitHub App ${app.name}`,
              hint: "private repository",
            })),
          ],
          "public",
        );
        githubApp = choice === "public" ? undefined : choice;
      }
    }

    const body = {
      project_uuid: project.uuid,
      server_uuid: server.uuid,
      environment_uuid: environment.uuid,
      git_repository: context.repository,
      git_branch: context.branch,
      build_pack: "dockercompose",
      docker_compose_location: "/compose.yaml",
      docker_compose_domains: [{ name: "proxy", domain: `https://${context.domain}:80` }],
      name: context.name,
      description: "DjangoStack",
      instant_deploy: false,
      ...(githubApp ? { github_app_uuid: githubApp } : {}),
    };
    const created = await api.post<{ uuid: string }>(
      githubApp ? "/applications/private-github-app" : "/applications/public",
      body,
    );
    ask.step(`Created the application ${context.name} from ${context.repository} (${context.branch})`);

    const link: DeployLink = {
      provider: "coolify",
      url: api.url,
      project: project.uuid,
      environment: environment.uuid,
      application: created.uuid,
    };
    await this.pushEnv(link, context.env);
    ask.step(`Set ${Object.keys(context.env).length} environment variables`);
    return { project: link.project, environment: link.environment, application: link.application };
  }

  async pushEnv(link: DeployLink, env: Record<string, string>) {
    const data = Object.entries(env).map(([key, value]) => ({
      key,
      value,
      // Literal: Coolify must not read $ in generated secrets as a variable.
      is_literal: true,
      is_preview: false,
    }));
    await this.api.patch(`/applications/${enc(link.application)}/envs/bulk`, { data });
  }

  async deploy(link: DeployLink, options: { force: boolean }): Promise<string> {
    const query = `uuid=${enc(link.application)}${options.force ? "&force=true" : ""}`;
    const result = await this.api.post<{ deployments?: { deployment_uuid?: string; message?: string }[] }>(
      `/deploy?${query}`,
    );
    const id = result?.deployments?.[0]?.deployment_uuid;
    if (!id) throw new Error(result?.deployments?.[0]?.message ?? "Coolify did not start a deployment.");
    return id;
  }

  async deployment(link: DeployLink, id: string): Promise<Deployment> {
    return toDeployment(this.api, link, await this.api.get<CoolifyDeployment>(`/deployments/${enc(id)}`));
  }

  async deployments(link: DeployLink, limit: number): Promise<Deployment[]> {
    const result = await this.api.get<CoolifyDeployment[] | { deployments?: CoolifyDeployment[] }>(
      `/deployments/applications/${enc(link.application)}?take=${limit}`,
    );
    const items = Array.isArray(result) ? result : (result?.deployments ?? []);
    return items.map((item) => toDeployment(this.api, link, item));
  }

  async status(link: DeployLink): Promise<AppStatus> {
    const app = await this.api.get<CoolifyApplication>(`/applications/${enc(link.application)}`);
    return {
      state: appState(app.status),
      detail: app.status ?? "unknown",
      domains: composeDomains(app),
      branch: app.git_branch,
      url: appUrl(this.api, link),
    };
  }
}

export const coolify: DeployProvider = {
  id: "coolify",
  name: "Coolify",
  auth: {
    kind: "token",
    env: "DSTACK_COOLIFY_TOKEN",
    help: (url) =>
      `Create one in Coolify under Keys & Tokens › API tokens (${url}/security/api-tokens) with the read, write and deploy permissions. API access must be on under Settings › Advanced.`,
  },
  source: "remote",
  target: urlTarget("Coolify", "https://coolify.example.com"),
  platformEnv: PLATFORM_ENV,
  setupFlags: [
    ...SHARED_SETUP_FLAGS,
    { name: "githubApp", description: "A Coolify GitHub App for a private repository, or public" },
  ],
  connect: (url, token) => {
    if (!token) throw new Error("Coolify needs an API key.");
    return new CoolifyClient(url, token);
  },
};

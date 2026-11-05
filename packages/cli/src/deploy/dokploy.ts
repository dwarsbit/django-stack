import { type Fetch, PLATFORM_ENV, SHARED_SETUP_FLAGS } from "./coolify";
import type {
  AppState,
  AppStatus,
  DeployLink,
  Deployment,
  DeploymentStatus,
  DeployProvider,
  ProviderClient,
  SetupContext,
} from "./provider";
import { urlTarget } from "./provider";
import { envValue } from "./ssh";

/**
 * Dokploy (https://dokploy.com), through its API at /api/<router>.<procedure>
 * with an API key in the x-api-key header. The project deploys as a Docker
 * Compose service that Dokploy builds on its server from the git
 * repository; Dokploy's Traefik gets the certificate and forwards to the
 * `proxy` service (Caddy) on port 80, so Caddy gets the same variables as
 * behind Coolify.
 */

interface DokployCompose {
  composeId: string;
  name: string;
  appName?: string;
  composeStatus?: string;
  customGitBranch?: string | null;
  environmentId?: string;
  domains?: DokployDomain[];
  deployments?: DokployDeployment[];
}

interface DokployEnvironment {
  environmentId: string;
  name: string;
  compose?: DokployCompose[];
}

interface DokployProject {
  projectId: string;
  name: string;
  description?: string | null;
  environments?: DokployEnvironment[];
}

interface DokployServer {
  serverId: string;
  name: string;
  ipAddress?: string;
}

interface DokployDomain {
  domainId?: string;
  host: string;
  https?: boolean;
  serviceName?: string | null;
}

export interface DokployDeployment {
  deploymentId: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
}

export class DokployError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class DokployApi {
  constructor(
    readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async request<T>(method: "GET" | "POST", procedure: string, input?: Record<string, unknown>): Promise<T> {
    let path = `${this.url}/api/${procedure}`;
    if (method === "GET" && input) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input))
        if (value !== undefined) query.set(key, String(value));
      path += `?${query}`;
    }
    let response: Response;
    try {
      response = await this.fetchImpl(path, {
        method,
        headers: {
          "x-api-key": this.token,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(input ?? {}) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new DokployError(`Could not reach Dokploy at ${this.url}: ${(error as Error).message}`, 0);
    }
    const text = await response.text();
    if (!response.ok) throw new DokployError(errorMessage(response.status, text, this.url), response.status);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  get = <T>(procedure: string, input?: Record<string, unknown>) => this.request<T>("GET", procedure, input);
  post = <T>(procedure: string, input: Record<string, unknown>) => this.request<T>("POST", procedure, input);
}

function errorMessage(status: number, text: string, url: string): string {
  if (status === 401)
    return `Dokploy at ${url} rejected the API key. Run dstack deploy login to enter a new one.`;
  if (status === 403)
    return "The API key may not do this. Create it as a user who may manage projects in Dokploy.";
  if (status === 404 && text.includes("<html")) return `${url} does not answer like Dokploy; check the URL.`;
  let message = "";
  try {
    const body = JSON.parse(text) as { message?: string; error?: { message?: string } };
    message = body.message ?? body.error?.message ?? "";
  } catch {
    message = text.slice(0, 200);
  }
  return `Dokploy answered ${status}${message ? `: ${message.trim()}` : "."}`;
}

/** A deployment's status: running, done, error or cancelled in Dokploy. */
export function dokployDeploymentStatus(value: string | null | undefined): DeploymentStatus {
  if (value === "done") return "finished";
  if (value === "running") return "building";
  if (value === "queued" || value === "idle") return "queued";
  if (value === "cancelled") return "cancelled";
  return "failed";
}

/** The service state from the compose status, which tracks the last deploy. */
export function dokployAppState(value: string | undefined): AppState {
  if (value === "done") return "running";
  if (value === "error") return "degraded";
  if (value === "idle") return "stopped";
  return "unknown";
}

/** A .env text for Dokploy, which writes it next to compose.yaml. */
export function envText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${envValue(value)}`)
    .join("\n");
}

function composeUrl(api: DokployApi, link: DeployLink): string {
  return `${api.url}/dashboard/project/${link.project}/environment/${link.environment}/services/compose/${link.application}`;
}

/** Finds a name or id in a list. */
function find<T>(
  items: T[],
  wanted: string,
  id: (item: T) => string,
  name: (item: T) => string,
): T | undefined {
  return items.find((item) => id(item) === wanted) ?? items.find((item) => name(item) === wanted);
}

const LOCAL_SERVER = "dokploy";

export class DokployClient implements ProviderClient {
  readonly api: DokployApi;

  constructor(url: string, token: string, fetchImpl?: Fetch) {
    this.api = new DokployApi(url, token, fetchImpl);
  }

  async verify(): Promise<string> {
    // Checks the key; every user may list projects.
    await this.api.get("project.all");
    const version = await this.api.get<string>("settings.getDokployVersion").catch(() => undefined);
    return typeof version === "string" && version.trim() ? version.trim() : "(version unknown)";
  }

  async setup(context: SetupContext) {
    const { ask, options } = context;
    if (!context.repository) throw new Error("Dokploy builds from a git repository; pass --repository.");
    const api = this.api;

    // Dokploy itself, or a remote server it manages.
    const servers = (await api.get<DokployServer[]>("server.all").catch(() => [] as DokployServer[])) ?? [];
    let serverId: string | undefined;
    if (options.server && options.server !== LOCAL_SERVER) {
      const server = find(
        servers,
        options.server,
        (item) => item.serverId,
        (item) => item.name,
      );
      if (!server) throw new Error(`Dokploy has no server ${options.server}.`);
      serverId = server.serverId;
    } else if (!options.server && servers.length && ask.interactive) {
      const choice = await ask.select(
        "Server to deploy to",
        [
          { value: LOCAL_SERVER, label: "The Dokploy server" },
          ...servers.map((item) => ({ value: item.serverId, label: item.name, hint: item.ipAddress })),
        ],
        LOCAL_SERVER,
      );
      serverId = choice === LOCAL_SERVER ? undefined : choice;
    }

    const projects = (await api.get<DokployProject[]>("project.all")) ?? [];
    const projectName = options.project ?? context.name;
    let project = find(
      projects,
      projectName,
      (item) => item.projectId,
      (item) => item.name,
    );
    if (!options.project && ask.interactive && projects.length) {
      const NEW = "";
      const id = await ask.select(
        "Dokploy project",
        [
          ...(project ? [] : [{ value: NEW, label: `Create ${projectName}` }]),
          ...projects.map((item) => ({
            value: item.projectId,
            label: item.name,
            hint: item.description ?? undefined,
          })),
        ],
        project?.projectId ?? NEW,
      );
      project =
        id === NEW
          ? undefined
          : find(
              projects,
              id,
              (item) => item.projectId,
              (item) => item.name,
            );
    }
    if (!project) {
      const created = await api.post<{ project?: DokployProject } & Partial<DokployProject>>(
        "project.create",
        {
          name: projectName,
          description: "DjangoStack",
        },
      );
      const projectId = created?.project?.projectId ?? created?.projectId;
      if (!projectId) throw new Error("Dokploy created the project but did not return its id.");
      project = { projectId, name: projectName };
      ask.step(`Created the Dokploy project ${projectName}`);
    }

    const environmentName = options.environment ?? "production";
    const environments = await api
      .get<DokployEnvironment[]>("environment.byProjectId", { projectId: project.projectId })
      .catch((error: DokployError) => {
        if (error.status === 404)
          throw new Error("This Dokploy has no environments; update Dokploy to a version with environments.");
        throw error;
      });
    let environment = find(
      environments ?? [],
      environmentName,
      (item) => item.environmentId,
      (item) => item.name,
    );
    if (!environment) {
      const created = await api.post<Partial<DokployEnvironment>>("environment.create", {
        name: environmentName,
        projectId: project.projectId,
      });
      const environmentId =
        created?.environmentId ??
        (
          await api.get<DokployEnvironment[]>("environment.byProjectId", { projectId: project.projectId })
        ).find((item) => item.name === environmentName)?.environmentId;
      if (!environmentId) throw new Error("Dokploy created the environment but did not return its id.");
      environment = { environmentId, name: environmentName };
      ask.step(`Created the environment ${environmentName}`);
    }

    const created = await api.post<Partial<DokployCompose>>("compose.create", {
      name: context.name,
      environmentId: environment.environmentId,
      projectId: project.projectId,
      composeType: "docker-compose",
      description: "DjangoStack",
      ...(serverId ? { serverId } : {}),
    });
    let composeId = created?.composeId;
    if (!composeId) {
      const one = await api.get<DokployEnvironment>("environment.one", {
        environmentId: environment.environmentId,
      });
      composeId = (one?.compose ?? []).filter((item) => item.name === context.name).at(-1)?.composeId;
    }
    if (!composeId) throw new Error("Dokploy created the compose service but did not return its id.");

    await api.post("compose.update", {
      composeId,
      sourceType: "git",
      customGitUrl: context.repository,
      customGitBranch: context.branch,
      composePath: "./compose.yaml",
      env: envText(context.env),
    });
    ask.step(`Created the compose service ${context.name} from ${context.repository} (${context.branch})`);

    const domains = await api.get<DokployDomain[]>("domain.byComposeId", { composeId }).catch(() => []);
    if (!(domains ?? []).some((item) => item.host === context.domain)) {
      await api.post("domain.create", {
        host: context.domain,
        path: "/",
        port: 80,
        https: true,
        certificateType: "letsencrypt",
        composeId,
        serviceName: "proxy",
        domainType: "compose",
      });
    }
    ask.step(`Gave the proxy service https://${context.domain}`);

    return { project: project.projectId, environment: environment.environmentId, application: composeId };
  }

  async pushEnv(link: DeployLink, env: Record<string, string>): Promise<void> {
    await this.api.post("compose.update", { composeId: link.application, env: envText(env) });
  }

  async deploy(link: DeployLink): Promise<string> {
    const before = new Set((await this.raw(link)).map((item) => item.deploymentId));
    await this.api.post("compose.deploy", { composeId: link.application, title: "dstack deploy" });
    // Dokploy queues the deploy and creates its record shortly after.
    for (let attempt = 0; attempt < 20; attempt++) {
      const fresh = (await this.raw(link)).find((item) => !before.has(item.deploymentId));
      if (fresh) return fresh.deploymentId;
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    throw new Error(
      `Dokploy took the deploy but shows no deployment for it yet. See ${composeUrl(this.api, link)}`,
    );
  }

  /** How long `deploy` waits between looks for the new deployment; tests set it to 0. */
  pollMs = 1000;

  /** The deployments, newest first. */
  private async raw(link: DeployLink): Promise<DokployDeployment[]> {
    const items =
      (await this.api.get<DokployDeployment[]>("deployment.allByCompose", { composeId: link.application })) ??
      [];
    return [...items].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }

  private toDeployment(link: DeployLink, item: DokployDeployment): Deployment {
    const status = dokployDeploymentStatus(item.status);
    const url = composeUrl(this.api, link);
    return {
      id: item.deploymentId,
      status,
      message:
        item.title && item.title !== "dstack deploy"
          ? item.title
          : (item.description ?? undefined) || undefined,
      createdAt: item.createdAt,
      updatedAt: item.finishedAt ?? item.startedAt ?? undefined,
      url,
      // Dokploy streams build logs to its dashboard only, not through the API.
      log: [
        ...(item.errorMessage ? [{ text: item.errorMessage, stderr: true }] : []),
        { text: `Dokploy shows the build log in its dashboard: ${url} (Deployments)`, stderr: false },
      ],
    };
  }

  async deployment(link: DeployLink, id: string): Promise<Deployment> {
    const item = (await this.raw(link)).find((deployment) => deployment.deploymentId === id);
    if (!item) throw new Error(`Dokploy has no deployment ${id} for this service.`);
    return this.toDeployment(link, item);
  }

  async deployments(link: DeployLink, limit: number): Promise<Deployment[]> {
    return (await this.raw(link))
      .slice(0, limit)
      .map((item) => ({ ...this.toDeployment(link, item), log: [] }));
  }

  async status(link: DeployLink): Promise<AppStatus> {
    const compose = await this.api.get<DokployCompose>("compose.one", { composeId: link.application });
    const domains = (compose.domains ?? []).map(
      (item) => `${item.https === false ? "http" : "https"}://${item.host}`,
    );
    return {
      state: dokployAppState(compose.composeStatus),
      detail: compose.composeStatus ?? "unknown",
      domains,
      branch: compose.customGitBranch ?? undefined,
      url: composeUrl(this.api, link),
    };
  }
}

export const dokploy: DeployProvider = {
  id: "dokploy",
  name: "Dokploy",
  auth: {
    kind: "token",
    env: "DSTACK_DOKPLOY_TOKEN",
    help: (url) =>
      `Create one in Dokploy under Settings › Profile › API/CLI (${url}/dashboard/settings/profile), as a user who may create projects.`,
  },
  source: "remote",
  target: urlTarget("Dokploy", "https://dokploy.example.com"),
  platformEnv: PLATFORM_ENV,
  setupFlags: SHARED_SETUP_FLAGS,
  connect: (url, token) => {
    if (!token) throw new Error("Dokploy needs an API key.");
    return new DokployClient(url, token);
  },
};

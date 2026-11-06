import { readFileSync } from "node:fs";
import { type CommandRunner, resolveCompose, systemRunner } from "./bunny";
import type { Fetch } from "./coolify";
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
import { planRailway, type RailwayPlan } from "./railway-compose";

/**
 * Railway (https://railway.com), through its GraphQL API with an account or
 * workspace token. Railway has no Compose: the CLI reads the resolved
 * compose.yaml and creates one Railway service per production service in a
 * Railway project. Railway builds the backend and the frontend from their
 * directories in the GitHub repository (through the Railway GitHub App) and
 * deploys again on every push; Postgres runs Railway's own Postgres image
 * with a volume, and Caddy gets the Caddyfile through a variable. Railway's
 * edge holds the certificate of the site's domain and forwards to Caddy on
 * port 80, which routes to the other services on the private network.
 *
 * Link ids: project = the Railway project, environment = its environment,
 * application = the service with the domain (the proxy).
 */

export const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

/** Variables that put Caddy behind Railway's edge. */
export const RAILWAY_PLATFORM_ENV: Record<string, string> = {
  CADDY_ADDRESS: ":80",
  // Railway's edge has no fixed address range, and only it and the project's
  // own services reach Caddy, so Caddy trusts the headers the edge sets.
  TRUSTED_PROXIES: "0.0.0.0/0 ::/0",
  NUM_PROXIES: "2",
};

type Json = Record<string, unknown>;

export class RailwayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class RailwayApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
    readonly url = RAILWAY_API,
  ) {}

  async query<T = Json>(query: string, variables: Json = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new RailwayError(`Could not reach Railway: ${(error as Error).message}`, 0);
    }
    const raw = await response.text();
    let body: { data?: T; errors?: { message?: string }[] } | undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {}
    const message = body?.errors
      ?.map((item) => item.message)
      .filter(Boolean)
      .join("; ");
    if (response.status === 401 || response.status === 403 || /not authori[sz]ed/i.test(message ?? ""))
      throw new RailwayError(
        "Railway refused the token. Create an account or workspace token at https://railway.com/account/tokens and run dstack deploy login.",
        response.status,
      );
    if (!response.ok || message || !body?.data)
      throw new RailwayError(
        `Railway answered ${response.status}: ${message || raw.slice(0, 200) || "no details"}`,
        response.status,
      );
    return body.data;
  }
}

/** A deployment's status in Railway's words. */
export function railwayDeploymentStatus(value: string | undefined): DeploymentStatus {
  switch (value) {
    case "SUCCESS":
    case "SLEEPING":
    // A deployment a newer one replaced; it ran.
    case "REMOVED":
    case "REMOVING":
      return "finished";
    case "BUILDING":
    case "DEPLOYING":
      return "building";
    case "QUEUED":
    case "WAITING":
    case "INITIALIZING":
    case "NEEDS_APPROVAL":
      return "queued";
    case "SKIPPED":
      return "cancelled";
    default:
      return "failed";
  }
}

/** The state of one deploy across services: failed when one failed, done when all are. */
export function groupStatus(statuses: DeploymentStatus[]): DeploymentStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("building")) return "building";
  if (statuses.includes("queued")) return "queued";
  if (statuses.length && statuses.every((status) => status === "cancelled")) return "cancelled";
  return "finished";
}

export interface RailwayDeployment {
  id: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  meta?: Json | null;
}

export interface RailwayInstance {
  serviceId: string;
  serviceName: string;
  source?: { repo?: string | null; image?: string | null } | null;
  latestDeployment?: RailwayDeployment | null;
  domains?: {
    customDomains?: { domain: string }[];
    serviceDomains?: { domain: string }[];
  } | null;
}

interface RailwayProject {
  id: string;
  name: string;
  services: { edges: { node: { id: string; name: string } }[] };
  environments: {
    edges: { node: { id: string; name: string; serviceInstances: { edges: { node: RailwayInstance }[] } } }[];
  };
}

const DEPLOYMENT_FIELDS = "id status createdAt updatedAt meta";

const PROJECT_QUERY = `query Project($id: String!) {
  project(id: $id) {
    id name
    services { edges { node { id name } } }
    environments { edges { node { id name serviceInstances { edges { node {
      serviceId serviceName
      source { repo image }
      latestDeployment { ${DEPLOYMENT_FIELDS} }
      domains { customDomains { domain } serviceDomains { domain } }
    } } } } } }
  }
}`;

/** owner/name of a GitHub repository URL; Railway builds from GitHub only. */
export function githubRepository(url: string): string {
  const match = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!match?.[1])
    throw new Error(
      `Railway builds from GitHub repositories only, and ${url} is not one. Push the project to GitHub first.`,
    );
  return match[1];
}

function commitOf(deployment: RailwayDeployment): string | undefined {
  const value = deployment.meta?.commitHash;
  return typeof value === "string" && value ? value : undefined;
}

function metaText(deployment: RailwayDeployment, key: string): string | undefined {
  const value = deployment.meta?.[key];
  return typeof value === "string" && value ? value : undefined;
}

export function railwayDashboardUrl(link: DeployLink): string {
  return `https://railway.com/project/${encodeURIComponent(link.project)}?environmentId=${encodeURIComponent(link.environment)}`;
}

function find<T extends { id: string; name: string }>(items: T[], wanted: string): T | undefined {
  return items.find((item) => item.id === wanted) ?? items.find((item) => item.name === wanted);
}

export interface RailwayClientOptions {
  run?: CommandRunner;
  /** Reads a file that compose.yaml bind-mounts or builds. */
  readFile?: (path: string) => string;
}

export class RailwayClient implements ProviderClient {
  readonly api: RailwayApi;
  private readonly run: CommandRunner;
  private readonly readFile: (path: string) => string;

  constructor(token: string, fetchImpl?: Fetch, options: RailwayClientOptions = {}) {
    this.api = new RailwayApi(token, fetchImpl);
    this.run = options.run ?? systemRunner;
    this.readFile = options.readFile ?? ((path) => readFileSync(path, "utf8"));
  }

  /** How long `deploy` and `rollback` wait between looks for a new deployment; tests set it to 0. */
  pollMs = 1000;

  async verify(): Promise<string> {
    const data = await this.api.query<{ me?: { name?: string; email?: string } }>(
      "query { me { name email } }",
    );
    const who = data.me?.email ?? data.me?.name;
    return who ? `API (${who})` : "API";
  }

  async plan(directory: string, env: Record<string, string>): Promise<RailwayPlan> {
    const project = await resolveCompose(this.run, directory, env);
    return planRailway(project, { directory, readFile: this.readFile });
  }

  async project(id: string): Promise<RailwayProject> {
    const data = await this.api.query<{ project: RailwayProject }>(PROJECT_QUERY, { id });
    return data.project;
  }

  /** The service instances of the link's environment. */
  async instances(link: DeployLink): Promise<RailwayInstance[]> {
    const project = await this.project(link.project);
    const environment = project.environments.edges.find((edge) => edge.node.id === link.environment);
    if (!environment) throw new Error(`The Railway project has no environment ${link.environment}.`);
    return environment.node.serviceInstances.edges.map((edge) => edge.node);
  }

  /** The services Railway builds from the repository; the first one is the one deploys are listed by. */
  private async built(link: DeployLink): Promise<RailwayInstance[]> {
    const items = (await this.instances(link)).filter((item) => item.source?.repo);
    if (!items.length) throw new Error("No service of the Railway project builds from the repository.");
    return items.sort((a, b) =>
      a.serviceName === "backend"
        ? -1
        : b.serviceName === "backend"
          ? 1
          : a.serviceName.localeCompare(b.serviceName),
    );
  }

  private async workspace(wanted: string | undefined, context: SetupContext): Promise<string> {
    const data = await this.api.query<{ me: { workspaces?: { id: string; name: string }[] } }>(
      "query { me { workspaces { id name } } }",
    );
    const workspaces = data.me.workspaces ?? [];
    if (wanted) {
      const workspace = find(workspaces, wanted);
      if (!workspace) throw new Error(`Railway has no workspace ${wanted}.`);
      return workspace.id;
    }
    if (workspaces.length === 1) return workspaces[0]?.id as string;
    if (!workspaces.length) throw new Error("This Railway token sees no workspace; pass --workspace.");
    return context.ask.select(
      "Railway workspace",
      workspaces.map((item) => ({ value: item.id, label: item.name })),
      workspaces[0]?.id,
    );
  }

  private async projects(workspaceId: string): Promise<{ id: string; name: string }[]> {
    const data = await this.api.query<{
      me: { workspaces?: { id: string; projects?: { edges: { node: { id: string; name: string } }[] } }[] };
    }>("query { me { workspaces { id projects(first: 500) { edges { node { id name } } } } } }");
    const workspace = (data.me.workspaces ?? []).find((item) => item.id === workspaceId);
    return (workspace?.projects?.edges ?? []).map((edge) => edge.node);
  }

  async setup(context: SetupContext) {
    const { ask, options, directory } = context;
    if (!context.repository) throw new Error("Railway builds from a GitHub repository; pass --repository.");
    const repo = githubRepository(context.repository);

    // Check the plan before anything is created.
    const plan = await this.plan(directory, context.env);
    if (plan.ignored.length)
      ask.step(`Railway does not apply these settings of compose.yaml: ${plan.ignored.join(", ")}`);

    const workspaceId = await this.workspace(options.workspace, context);
    let projectId: string | undefined;
    if (options.project) {
      const project = find(await this.projects(workspaceId), options.project);
      if (!project) throw new Error(`The Railway workspace has no project ${options.project}.`);
      projectId = project.id;
    } else {
      const created = await this.api.query<{ projectCreate: { id: string } }>(
        `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
        { input: { name: context.name, description: "DjangoStack", workspaceId } },
      );
      projectId = created.projectCreate.id;
      ask.step(`Created the Railway project ${context.name}`);
    }

    const environmentName = options.environment ?? "production";
    let project = await this.project(projectId);
    let environmentId = project.environments.edges.find(
      (edge) => edge.node.id === environmentName || edge.node.name === environmentName,
    )?.node.id;
    if (!environmentId) {
      const created = await this.api.query<{ environmentCreate: { id: string } }>(
        `mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id } }`,
        { input: { projectId, name: environmentName } },
      );
      environmentId = created.environmentCreate.id;
      ask.step(`Created the environment ${environmentName}`);
      project = await this.project(projectId);
    }

    const existing = project.services.edges.map((edge) => edge.node);
    for (const name of plan.services.map((item) => item.name))
      if (existing.some((item) => item.name === name))
        throw new Error(
          `The Railway project already has a service ${name}. Set up a new project, or delete the service in Railway first.`,
        );

    let publicId: string | undefined;
    for (const service of plan.services) {
      const created = await this.api.query<{ serviceCreate: { id: string } }>(
        `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        { input: { projectId, environmentId, name: service.name } },
      );
      const serviceId = created.serviceCreate.id;
      if (service.public) publicId = serviceId;

      const env = { ...service.env };
      if (service.source.kind === "repo" && service.source.dockerfile)
        env.RAILWAY_DOCKERFILE_PATH = service.source.dockerfile;
      // The first deploy starts when the source is connected.
      await this.upsertVariables(projectId, environmentId, serviceId, env, true);

      await this.api.query(
        `mutation ($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) {
          serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
        }`,
        {
          serviceId,
          environmentId,
          input: {
            ...(service.source.kind === "repo" ? { rootDirectory: service.source.rootDirectory } : {}),
            ...(service.startCommand ? { startCommand: service.startCommand } : {}),
            ...(service.healthcheckPath ? { healthcheckPath: service.healthcheckPath } : {}),
            ...(service.watchPatterns ? { watchPatterns: service.watchPatterns } : {}),
            numReplicas: service.replicas,
          },
        },
      );

      if (service.volume)
        await this.api.query(`mutation ($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`, {
          input: { projectId, environmentId, serviceId, mountPath: service.volume },
        });

      // Connecting the source starts the first deploy, so it comes last.
      await this.api.query(
        `mutation ($id: String!, $input: ServiceConnectInput!) { serviceConnect(id: $id, input: $input) { id } }`,
        {
          id: serviceId,
          input:
            service.source.kind === "repo"
              ? { repo, branch: context.branch }
              : { image: service.source.image },
        },
      );
      ask.step(
        `Created the service ${service.name} ${
          service.source.kind === "repo"
            ? `from ${repo}${service.source.rootDirectory} (${context.branch})`
            : `from ${service.source.image}`
        }${service.volume ? ` with a volume at ${service.volume}` : ""}`,
      );
    }
    if (!publicId) throw new Error("The plan has no public service.");

    const domain = await this.api.query<{
      customDomainCreate: {
        status?: {
          dnsRecords?: { hostlabel?: string; fqdn?: string; recordType?: string; requiredValue?: string }[];
        };
      };
    }>(
      `mutation ($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) { id status { dnsRecords { hostlabel fqdn recordType requiredValue } } }
      }`,
      {
        input: {
          projectId,
          environmentId,
          serviceId: publicId,
          domain: context.domain,
          targetPort: plan.services.find((item) => item.public)?.port ?? 80,
        },
      },
    );
    ask.step(`Gave the ${plan.services.find((item) => item.public)?.name} service https://${context.domain}`);
    const records = domain.customDomainCreate.status?.dnsRecords ?? [];
    if (records.length)
      for (const record of records)
        ask.step(
          `Add this DNS record: ${record.fqdn ?? record.hostlabel ?? context.domain} ${record.recordType?.replace(/^DNS_RECORD_TYPE_/, "") ?? "CNAME"} ${record.requiredValue ?? ""}`.trim(),
        );
    else
      ask.step(`Add the DNS record Railway shows for ${context.domain} under the proxy service's settings.`);

    return { project: projectId, environment: environmentId, application: publicId };
  }

  private async upsertVariables(
    projectId: string,
    environmentId: string,
    serviceId: string,
    variables: Record<string, string>,
    skipDeploys: boolean,
  ) {
    await this.api.query(
      `mutation ($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      { input: { projectId, environmentId, serviceId, variables, skipDeploys } },
    );
  }

  async pushEnv(link: DeployLink, env: Record<string, string>): Promise<void> {
    const directory = link.directory ?? process.cwd();
    const plan = await this.plan(directory, env);
    const instances = await this.instances(link);
    for (const service of plan.services) {
      const instance = instances.find((item) => item.serviceName === service.name);
      if (!instance) throw new Error(missingService(service.name));
      // Railway deploys the services whose variables changed.
      await this.upsertVariables(link.project, link.environment, instance.serviceId, service.env, false);
    }
  }

  async deploy(link: DeployLink): Promise<string> {
    const services = await this.built(link);
    let primary: string | undefined;
    for (const service of services) {
      const data = await this.api.query<{ serviceInstanceDeployV2: string }>(
        `mutation ($serviceId: String!, $environmentId: String!) {
          serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        { serviceId: service.serviceId, environmentId: link.environment },
      );
      primary ??= typeof data.serviceInstanceDeployV2 === "string" ? data.serviceInstanceDeployV2 : undefined;
    }
    if (primary) return primary;
    return this.newest(link, services[0]?.serviceId as string, services[0]?.latestDeployment?.id);
  }

  /** Waits for a deployment newer than `before` of a service; returns its id. */
  private async newest(link: DeployLink, serviceId: string, before: string | undefined): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [latest] = await this.raw(link, serviceId, 1);
      if (latest && latest.id !== before) return latest.id;
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
    throw new Error(
      `Railway took the deploy but shows no deployment for it yet. See ${railwayDashboardUrl(link)}`,
    );
  }

  /** A service's deployments, newest first. */
  async raw(link: DeployLink, serviceId: string, limit: number): Promise<RailwayDeployment[]> {
    const data = await this.api.query<{ deployments: { edges: { node: RailwayDeployment }[] } }>(
      `query ($input: DeploymentListInput!, $first: Int) {
        deployments(input: $input, first: $first) { edges { node { ${DEPLOYMENT_FIELDS} } } }
      }`,
      { input: { projectId: link.project, environmentId: link.environment, serviceId }, first: limit },
    );
    return data.deployments.edges
      .map((edge) => edge.node)
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }

  /** The deployments of the other built services that belong to a deployment of the first one. */
  private siblings(
    primary: RailwayDeployment,
    others: { service: RailwayInstance; deployments: RailwayDeployment[] }[],
  ): { service: RailwayInstance; deployment: RailwayDeployment }[] {
    const commit = commitOf(primary);
    const time = new Date(primary.createdAt ?? 0).getTime();
    const result: { service: RailwayInstance; deployment: RailwayDeployment }[] = [];
    for (const { service, deployments } of others) {
      const match = commit
        ? deployments.find((item) => commitOf(item) === commit)
        : deployments
            .filter((item) => Math.abs(new Date(item.createdAt ?? 0).getTime() - time) < 10 * 60_000)
            .sort(
              (a, b) =>
                Math.abs(new Date(a.createdAt ?? 0).getTime() - time) -
                Math.abs(new Date(b.createdAt ?? 0).getTime() - time),
            )[0];
      if (match) result.push({ service, deployment: match });
    }
    return result;
  }

  private async group(link: DeployLink, limit: number) {
    const [first, ...rest] = await this.built(link);
    if (!first) throw new Error("No service of the Railway project builds from the repository.");
    const primary = await this.raw(link, first.serviceId, limit);
    const others = await Promise.all(
      rest.map(async (service) => ({
        service,
        deployments: await this.raw(link, service.serviceId, Math.max(limit, 10) * 2),
      })),
    );
    return { first, primary, others };
  }

  private toDeployment(
    link: DeployLink,
    primary: RailwayDeployment,
    siblings: { deployment: RailwayDeployment }[],
  ): Deployment {
    const statuses = [primary, ...siblings.map((item) => item.deployment)].map((item) =>
      railwayDeploymentStatus(item.status),
    );
    const commit = commitOf(primary);
    return {
      id: primary.id,
      status: groupStatus(statuses),
      commit: commit?.slice(0, 7),
      message: metaText(primary, "commitMessage")?.split("\n")[0],
      createdAt: primary.createdAt,
      updatedAt: primary.updatedAt,
      url: railwayDashboardUrl(link),
      log: [],
    };
  }

  async deployment(link: DeployLink, id: string): Promise<Deployment> {
    const { first, primary, others } = await this.group(link, 20);
    let item = primary.find((deployment) => deployment.id === id);
    if (!item) {
      const data = await this.api
        .query<{ deployment: RailwayDeployment }>(
          `query ($id: String!) { deployment(id: $id) { ${DEPLOYMENT_FIELDS} } }`,
          {
            id,
          },
        )
        .catch(() => undefined);
      item = data?.deployment;
    }
    if (!item) throw new Error(`Railway has no deployment ${id} for this project.`);
    const siblings = this.siblings(item, others);
    const deployment = this.toDeployment(link, item, siblings);
    const log: LogLine[] = [];
    for (const [service, part] of [
      [first, item] as const,
      ...siblings.map((sibling) => [sibling.service, sibling.deployment] as const),
    ]) {
      const lines = await this.logs(part).catch(() => []);
      for (const line of lines) log.push({ ...line, text: `${service.serviceName} | ${line.text}` });
    }
    return { ...deployment, log };
  }

  /** The build log of a deployment, and its deploy log once it runs. */
  private async logs(deployment: RailwayDeployment): Promise<LogLine[]> {
    type Log = { message?: string; severity?: string };
    const toLines = (items: Log[]) =>
      items.map((item) => ({ text: item.message ?? "", stderr: /error/i.test(item.severity ?? "") }));
    const build = await this.api.query<{ buildLogs: Log[] }>(
      `query ($deploymentId: String!, $limit: Int) { buildLogs(deploymentId: $deploymentId, limit: $limit) { message severity } }`,
      { deploymentId: deployment.id, limit: 500 },
    );
    const lines = toLines(build.buildLogs ?? []);
    if (["DEPLOYING", "SUCCESS", "CRASHED", "FAILED"].includes(deployment.status ?? "")) {
      const run = await this.api
        .query<{ deploymentLogs: Log[] }>(
          `query ($deploymentId: String!, $limit: Int) { deploymentLogs(deploymentId: $deploymentId, limit: $limit) { message severity } }`,
          { deploymentId: deployment.id, limit: 200 },
        )
        .catch(() => ({ deploymentLogs: [] as Log[] }));
      lines.push(...toLines(run.deploymentLogs ?? []));
    }
    return lines;
  }

  async deployments(link: DeployLink, limit: number): Promise<Deployment[]> {
    const { primary, others } = await this.group(link, Math.max(1, limit));
    return primary.slice(0, limit).map((item) => this.toDeployment(link, item, this.siblings(item, others)));
  }

  async rollback(link: DeployLink, to?: string): Promise<string> {
    const { first, primary, others } = await this.group(link, 20);
    let target: RailwayDeployment | undefined;
    if (to) {
      target = primary.find((item) => item.id === to);
      if (!target) throw new Error(`Railway has no deployment ${to} among the last 20.`);
    } else {
      // The one that ran before the running one.
      const running = primary.findIndex((item) => item.status === "SUCCESS");
      target = primary
        .slice(running + 1)
        .find((item) => ["SUCCESS", "REMOVED"].includes(item.status ?? "") && running >= 0);
      if (!target) throw new Error("There is no earlier deploy to roll back to.");
    }
    if (railwayDeploymentStatus(target.status) !== "finished")
      throw new Error(`Deploy ${target.id} did not finish, so it cannot be rolled back to.`);
    const before = primary[0]?.id;
    for (const deployment of [target, ...this.siblings(target, others).map((item) => item.deployment)])
      await this.api.query(`mutation ($id: String!) { deploymentRollback(id: $id) }`, { id: deployment.id });
    return this.newest(link, first.serviceId, before);
  }

  async status(link: DeployLink): Promise<AppStatus> {
    const instances = await this.instances(link);
    const states = instances.map((item) => item.latestDeployment?.status);
    let state: AppState = "unknown";
    if (!states.some(Boolean)) state = "stopped";
    else if (states.every((value) => value === "SUCCESS" || value === "SLEEPING")) state = "running";
    else if (states.some((value) => value === "FAILED" || value === "CRASHED" || value === "REMOVED"))
      state = "degraded";
    else if (states.some((value) => railwayDeploymentStatus(value ?? "") !== "finished")) state = "degraded";
    const detail = instances
      .map((item) => `${item.serviceName}:${(item.latestDeployment?.status ?? "none").toLowerCase()}`)
      .join(", ");
    const proxy = instances.find((item) => item.serviceId === link.application);
    const domains = (proxy?.domains?.customDomains ?? []).map((item) => `https://${item.domain}`);
    const backend = instances.find((item) => item.source?.repo && item.serviceName === "backend");
    const branch = (backend ?? instances.find((item) => item.source?.repo))?.latestDeployment;
    return {
      state,
      detail: detail || "no services",
      domains,
      branch: branch ? metaText(branch, "branch") : undefined,
      url: railwayDashboardUrl(link),
    };
  }
}

function missingService(name: string): string {
  return `The Railway project has no service ${name}. compose.yaml changed since setup: add the service in Railway, or run dstack deploy setup --provider railway --force to create a new project.`;
}

export const railway: DeployProvider = {
  id: "railway",
  name: "Railway",
  auth: {
    kind: "token",
    env: "DSTACK_RAILWAY_TOKEN",
    help: () =>
      "Create an account token, or a token of the workspace to deploy to, at https://railway.com/account/tokens. Connect the Railway GitHub App to the repository too: Railway builds from GitHub.",
  },
  source: "remote",
  target: {
    label: "Railway API",
    placeholder: RAILWAY_API,
    fixed: RAILWAY_API,
    normalize: () => RAILWAY_API,
  },
  platformEnv: RAILWAY_PLATFORM_ENV,
  setupFlags: [
    { name: "workspace", description: "Railway: the workspace, by name or id (default: the only one)" },
    { name: "project", description: "The platform's project, by name or id (default: the project name)" },
    { name: "environment", description: "The platform's environment (default: production)" },
  ],
  printsDns: true,
  connect: (_target, token) => {
    if (!token) throw new Error("Railway needs an API key.");
    return new RailwayClient(token);
  },
};

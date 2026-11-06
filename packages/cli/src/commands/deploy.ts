import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  type Ask,
  DEFAULT_PROVIDER,
  type DeployLink,
  type Deployment,
  type DeploymentStatus,
  type DeployProvider,
  deleteToken,
  getProvider,
  getToken,
  gitBranch,
  gitRemote,
  httpsRepository,
  LINK_FILE,
  PROVIDERS,
  type ProviderClient,
  readLink,
  saveToken,
  uncommittedReason,
  unpushedReason,
  writeLink,
} from "../deploy";
import { parseEnv } from "../env";
import { readProject } from "../project";
import { command, fail, intro, isInteractive, unwrap, url } from "../ui";

export interface DeployDirOptions {
  dir?: string;
}

const PRODUCTION_ENV = ".env.production";

function projectOrFail(options: DeployDirOptions) {
  try {
    return readProject(options.dir ?? ".");
  } catch (error) {
    fail((error as Error).message);
  }
}

function linkOrFail(directory: string): DeployLink {
  let link: DeployLink | undefined;
  try {
    link = readLink(directory);
  } catch (error) {
    fail((error as Error).message);
  }
  if (!link) fail(`This project is not set up for deploys yet. Run ${command("dstack deploy setup")}.`);
  return link;
}

function providerOrFail(id: string): DeployProvider {
  try {
    return getProvider(id);
  } catch (error) {
    fail((error as Error).message);
  }
}

/** Runs a provider call; a failure ends the command with its one-line reason. */
async function attempt<T>(work: Promise<T>, spinner?: ReturnType<typeof p.spinner>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    spinner?.error("Failed");
    fail((error as Error).message);
  }
}

/** The variables for the platform: .env.production plus what the platform needs. */
function deployEnv(directory: string, provider: DeployProvider): Record<string, string> {
  let file = join(directory, PRODUCTION_ENV);
  if (!existsSync(file)) {
    // On a server the project's .env may already be the production one.
    const env = parseEnv(readFileSync(join(directory, ".env"), "utf8"));
    if (!(env.COMPOSE_PROFILES ?? "").split(",").includes("prod"))
      fail(
        `${PRODUCTION_ENV} does not exist. Run ${command("dstack production --domain example.com")} first.`,
      );
    file = join(directory, ".env");
  }
  return { ...parseEnv(readFileSync(file, "utf8")), ...provider.platformEnv };
}

type TokenAuth = Extract<DeployProvider["auth"], { kind: "token" }>;

/** The API key settings of a provider, or a one-line failure for one that uses SSH. */
function tokenAuth(provider: DeployProvider): TokenAuth {
  if (provider.auth.kind !== "token")
    fail(`${provider.name} uses your SSH keys and ~/.ssh/config; there is no API key to save.`);
  return provider.auth;
}

async function askToken(provider: DeployProvider, instance: string): Promise<string> {
  p.log.info(tokenAuth(provider).help(instance));
  return unwrap(
    await p.password({
      message: `${provider.name} API key`,
      validate: (value) => (value?.trim() ? undefined : "Paste the API key."),
    }),
  ).trim();
}

/** Checks a key and saves it; returns it. */
async function login(provider: DeployProvider, instance: string, token: string): Promise<string> {
  const spinner = p.spinner();
  spinner.start(`Checking the key with ${instance}`);
  const version = await attempt(provider.connect(instance, token).verify(), spinner);
  spinner.stop(`${provider.name} ${version} accepts the key`);
  const where = saveToken(provider.id, instance, token);
  if (where === "keychain") p.log.success("Saved the key in the system keychain.");
  else
    p.log.warn(
      `There is no system keychain here, so the key is in ~/.config/dstack/credentials.json, readable only by you. Set ${tokenAuth(provider).env} instead to keep it off disk.`,
    );
  return token;
}

/** A client for a provider target: the saved key, or a new one when the CLI may ask. */
async function connect(
  provider: DeployProvider,
  instance: string,
  interactive: boolean,
): Promise<ProviderClient> {
  if (provider.auth.kind === "ssh") return attempt(Promise.resolve().then(() => provider.connect(instance)));
  const saved = getToken(provider.id, instance, provider.auth.env);
  if (saved) return provider.connect(instance, saved.token);
  if (!interactive)
    fail(
      `No ${provider.name} API key for ${instance}. Run ${command("dstack deploy login")} or set ${provider.auth.env}.`,
    );
  const token = await login(provider, instance, await askToken(provider, instance));
  return provider.connect(instance, token);
}

function promptAsk(interactive: boolean): Ask {
  return {
    interactive,
    async select(message, choices, initial) {
      if (!interactive) {
        if (initial !== undefined) return initial;
        fail(`${message}: pass it as a flag; see ${command("dstack deploy setup --help")}.`);
      }
      const value = await p.select({
        message,
        initialValue: initial,
        // Clack's option type is conditional on the value type, which a generic T does not narrow.
        options: choices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          hint: choice.hint,
        })) as never,
      });
      return unwrap(value) as never;
    },
    async text(message, options = {}) {
      if (!interactive) {
        if (options.initial) return options.initial;
        fail(`${message}: pass it as a flag.`);
      }
      return unwrap(
        await p.text({ message, placeholder: options.placeholder, initialValue: options.initial }),
      );
    },
    async confirm(message, initial = true) {
      if (!interactive) return initial;
      return unwrap(await p.confirm({ message, initialValue: initial }));
    },
    step: (message) => p.log.success(message),
  };
}

export interface SetupCommandOptions extends DeployDirOptions {
  provider?: string;
  url?: string;
  repository?: string;
  branch?: string;
  deploy?: boolean;
  force?: boolean;
  yes?: boolean;
  [flag: string]: unknown;
}

/** `dstack deploy setup`: create the application on the platform and link the project to it. */
export async function deploySetup(options: SetupCommandOptions) {
  const interactive = isInteractive(options.yes);
  const project = projectOrFail(options);
  intro("Deploy setup");

  const existing = existsSync(join(project.directory, LINK_FILE)) ? readLink(project.directory) : undefined;
  if (existing && !options.force)
    fail(`This project already deploys to ${existing.url} (${LINK_FILE}). Pass --force to set it up again.`);

  let providerId = options.provider;
  if (!providerId) {
    providerId =
      PROVIDERS.length === 1 || !interactive
        ? DEFAULT_PROVIDER.id
        : unwrap(
            await p.select({
              message: "Platform",
              options: PROVIDERS.map((item) => ({ value: item.id, label: item.name })),
            }),
          );
  }
  const provider = providerOrFail(providerId);

  let instance = options.url ?? provider.target.fixed;
  if (!instance) {
    if (!interactive) fail(`Pass --url, the address of your ${provider.name}.`);
    instance = unwrap(
      await p.text({
        message: provider.target.label,
        placeholder: provider.target.placeholder,
        validate: (value) => {
          try {
            provider.target.normalize(value ?? "");
          } catch (error) {
            return (error as Error).message;
          }
        },
      }),
    );
  }
  try {
    instance = provider.target.normalize(instance);
  } catch (error) {
    fail((error as Error).message);
  }

  const env = deployEnv(project.directory, provider);
  const domain = (env.SITE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain || domain.endsWith("localhost"))
    fail(
      `SITE_URL in ${PRODUCTION_ENV} is not a public domain. Run ${command("dstack production --domain example.com --force")}.`,
    );

  // Providers that upload the local commit need no repository.
  let repository = options.repository;
  if (provider.source === "remote") {
    if (!repository) {
      const remote = gitRemote(project.directory);
      if (!remote)
        fail("This project has no git remote origin. Push it to GitHub first, or pass --repository.");
      repository = remote;
    }
    try {
      repository = httpsRepository(repository);
    } catch (error) {
      fail((error as Error).message);
    }
  }
  const branch = options.branch ?? gitBranch(project.directory) ?? "main";

  const client = await connect(provider, instance, interactive);
  await attempt(client.verify());

  const flags: Record<string, string | undefined> = {};
  for (const flag of provider.setupFlags) flags[flag.name] = options[flag.name] as string | undefined;
  const ids = await attempt(
    client.setup({
      ask: promptAsk(interactive),
      directory: project.directory,
      name: project.name,
      repository,
      branch,
      domain,
      env,
      options: flags,
    }),
  );
  const link: DeployLink = { provider: provider.id, url: instance, ...ids, directory: project.directory };
  writeLink(project.directory, link);
  p.log.success(
    `Wrote ${pc.bold(LINK_FILE)}. It holds no secrets; commit it so others deploy to the same place.`,
  );
  p.note(
    [
      ...(provider.printsDns
        ? []
        : [
            `Point the DNS of ${pc.bold(domain)} at the ${provider.auth.kind === "ssh" ? "" : `${provider.name} `}server.`,
          ]),
      provider.auth.kind === "ssh"
        ? `To change variables, edit ${PRODUCTION_ENV} and run ${command("dstack deploy env push")}.`
        : `Change variables in ${provider.name}, or in ${PRODUCTION_ENV} and run ${command("dstack deploy env push")}.`,
    ].join("\n"),
    "Next",
  );

  const deployNow =
    options.deploy ??
    (interactive ? unwrap(await p.confirm({ message: "Deploy now?", initialValue: true })) : false);
  if (deployNow) {
    await startDeploy(project.directory, provider, link, client, { force: false, wait: true });
    return;
  }
  p.outro(`Deploy with ${command("dstack deploy")}`);
}

const STATUS_LABEL: Record<DeploymentStatus, string> = {
  queued: pc.dim("queued"),
  building: pc.yellow("building"),
  finished: pc.green("finished"),
  failed: pc.red("failed"),
  cancelled: pc.dim("cancelled"),
};

const DONE = new Set<DeploymentStatus>(["finished", "failed", "cancelled"]);
const POLL_MS = 3000;
const WAIT_LIMIT_MS = 45 * 60_000;

function printLog(deployment: Deployment, lines?: number) {
  const log = lines ? deployment.log.slice(-lines) : deployment.log;
  for (const line of log) process.stdout.write(`${line.stderr ? pc.red(line.text) : line.text}\n`);
}

async function follow(link: DeployLink, client: ProviderClient, id: string): Promise<Deployment> {
  const spinner = p.spinner();
  spinner.start("Queued");
  const started = Date.now();
  let deployment: Deployment | undefined;
  for (;;) {
    deployment = await attempt(client.deployment(link, id), spinner);
    if (DONE.has(deployment.status)) break;
    const last = deployment.log.at(-1)?.text.trim().slice(0, 70);
    const seconds = Math.round((Date.now() - started) / 1000);
    spinner.message(
      `${deployment.status === "queued" ? "Queued" : "Building"} ${pc.dim(`${seconds}s`)}${last ? pc.dim(` ${last}`) : ""}`,
    );
    if (Date.now() - started > WAIT_LIMIT_MS) {
      spinner.stop("Still running");
      fail(`The deploy takes longer than 45 minutes. Follow it with ${command("dstack deploy status")}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const summary = `${STATUS_LABEL[deployment.status]} after ${seconds}s`;
  if (deployment.status === "finished") spinner.stop(summary);
  else spinner.error(summary);
  return deployment;
}

/** Why the deploy would not include the local work, or undefined. */
async function notDeployedReason(
  directory: string,
  provider: DeployProvider,
  link: DeployLink,
  client: ProviderClient,
): Promise<string | undefined> {
  if (provider.source === "local") return uncommittedReason(directory);
  const status = await attempt(client.status(link));
  return status.branch ? unpushedReason(directory, status.branch) : undefined;
}

async function startDeploy(
  directory: string,
  provider: DeployProvider,
  link: DeployLink,
  client: ProviderClient,
  options: { force: boolean; wait: boolean; pushCheck?: boolean },
) {
  if (options.pushCheck !== false) {
    const reason = await notDeployedReason(directory, provider, link, client);
    if (reason) fail(`${reason} Or pass --no-push-check.`);
  }
  const id = await attempt(client.deploy(link, { force: options.force, directory }));
  await finishDeploy(link, client, id, options.wait);
}

/** Follows a started deploy, or reports where it runs when not waiting. */
async function finishDeploy(link: DeployLink, client: ProviderClient, id: string, wait: boolean) {
  if (!wait) {
    const deployment = await attempt(client.deployment(link, id));
    p.outro(
      `Started deploy ${pc.bold(id)}${deployment.url ? `: ${url(deployment.url)}` : ""}. Follow it with ${command("dstack deploy status --watch")}`,
    );
    return;
  }
  p.log.message(pc.dim("Ctrl+C stops following; the deploy goes on."));
  const deployment = await follow(link, client, id);
  if (deployment.status !== "finished") {
    printLog(deployment, 40);
    fail(
      `The deploy ${deployment.status === "cancelled" ? "was cancelled" : "failed"}. Full log: ${command(`dstack deploy logs ${id}`)}`,
    );
  }
  const status = await attempt(client.status(link));
  p.outro(`Deployed${status.domains.length ? `: ${status.domains.map(url).join(" ")}` : ""}`);
}

export interface DeployCommandOptions extends DeployDirOptions {
  force?: boolean;
  wait: boolean;
  pushCheck: boolean;
  yes?: boolean;
}

/** `dstack deploy`: start a deploy and follow it. */
export async function deploy(options: DeployCommandOptions) {
  const project = projectOrFail(options);
  const link = linkOrFail(project.directory);
  const provider = providerOrFail(link.provider);
  intro(`Deploy to ${provider.name}`);
  const client = await connect(provider, link.url, isInteractive(options.yes));
  await startDeploy(project.directory, provider, link, client, {
    force: Boolean(options.force),
    wait: options.wait,
    pushCheck: options.pushCheck,
  });
}

function ago(date: string | undefined): string {
  if (!date) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (Number.isNaN(seconds)) return "";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

const STATE_LABEL = {
  running: pc.green("running"),
  degraded: pc.yellow("degraded"),
  stopped: pc.red("stopped"),
  unknown: pc.dim("unknown"),
};

/** `dstack deploy status`: the application's state and its last deploys. */
export async function deployStatus(options: DeployDirOptions & { limit: string; watch?: boolean }) {
  const project = projectOrFail(options);
  const link = linkOrFail(project.directory);
  const provider = providerOrFail(link.provider);
  intro(`${provider.name} status`);
  const client = await connect(provider, link.url, isInteractive(false));
  const limit = Math.max(1, Number.parseInt(options.limit, 10) || 5);

  const [status, deployments] = await Promise.all([
    attempt(client.status(link)),
    attempt(client.deployments(link, limit)),
  ]);
  p.note(
    [
      `${pc.bold("State")}   ${STATE_LABEL[status.state]} ${pc.dim(`(${status.detail})`)}`,
      ...(status.domains.length ? [`${pc.bold("Site")}    ${status.domains.map(url).join(" ")}`] : []),
      ...(status.branch ? [`${pc.bold("Branch")}  ${status.branch}`] : []),
      ...(status.url ? [`${pc.bold(provider.name.padEnd(7))} ${url(status.url)}`] : []),
    ].join("\n"),
    project.name,
  );
  if (deployments.length) {
    p.log.message(
      deployments
        .map((item) =>
          [
            STATUS_LABEL[item.status].padEnd(18),
            pc.dim(ago(item.createdAt).padEnd(11)),
            item.commit ? pc.cyan(item.commit) : pc.dim("-------"),
            item.message ?? "",
          ].join("  "),
        )
        .join("\n"),
      { symbol: pc.dim("│") },
    );
  } else {
    p.log.message(pc.dim("No deploys yet."));
  }

  const running = deployments.find((item) => !DONE.has(item.status));
  if (running && options.watch) {
    const deployment = await follow(link, client, running.id);
    if (deployment.status !== "finished") {
      printLog(deployment, 40);
      fail(`The deploy failed. Full log: ${command(`dstack deploy logs ${running.id}`)}`);
    }
  } else if (running) {
    p.outro(`A deploy is ${running.status}. Follow it with ${command("dstack deploy status --watch")}`);
    return;
  }
  p.outro(pc.green("Done"));
}

/** `dstack deploy logs [deployment]`: the build log of a deploy, the latest by default. */
export async function deployLogs(id: string | undefined, options: DeployDirOptions) {
  const project = projectOrFail(options);
  const link = linkOrFail(project.directory);
  const provider = providerOrFail(link.provider);
  const client = await connect(provider, link.url, isInteractive(false));
  let deploymentId = id;
  if (!deploymentId) {
    const [latest] = await attempt(client.deployments(link, 1));
    if (!latest) fail("There are no deploys yet.");
    deploymentId = latest.id;
  }
  const deployment = await attempt(client.deployment(link, deploymentId));
  printLog(deployment);
  process.stderr.write(pc.dim(`Deploy ${deployment.id}: ${deployment.status}\n`));
  if (deployment.status === "failed") process.exitCode = 1;
}

/** `dstack deploy rollback [deployment]`: run an earlier release again. */
export async function deployRollback(
  id: string | undefined,
  options: DeployDirOptions & { wait: boolean; yes?: boolean },
) {
  const project = projectOrFail(options);
  const link = linkOrFail(project.directory);
  const provider = providerOrFail(link.provider);
  intro(`Roll back on ${provider.name}`);
  const client = await connect(provider, link.url, isInteractive(options.yes));
  if (!client.rollback)
    fail(
      `${provider.name} keeps no releases to roll back to. Deploy an earlier commit, or roll back in ${provider.name}.`,
    );
  const rollbackId = await attempt(client.rollback(link, id));
  p.log.info(pc.dim("The database is not rolled back; migrations of the newer release stay applied."));
  await finishDeploy(link, client, rollbackId, options.wait);
}

/** `dstack deploy env push`: upload .env.production to the platform again. */
export async function deployEnvPush(options: DeployDirOptions & { yes?: boolean }) {
  const project = projectOrFail(options);
  const link = linkOrFail(project.directory);
  const provider = providerOrFail(link.provider);
  intro("Push variables");
  const interactive = isInteractive(options.yes);
  const env = deployEnv(project.directory, provider);
  if (
    interactive &&
    !unwrap(
      await p.confirm({
        message: `Replace ${Object.keys(env).length} variables in ${provider.name} with the values from ${PRODUCTION_ENV}?`,
      }),
    )
  )
    fail("Cancelled.");
  const client = await connect(provider, link.url, interactive);
  await attempt(client.pushEnv(link, env));
  p.outro(`Set ${Object.keys(env).length} variables. They apply on the next ${command("dstack deploy")}`);
}

async function loginTarget(
  options: DeployDirOptions & { provider?: string; url?: string },
  interactive: boolean,
) {
  let link: DeployLink | undefined;
  try {
    const project = readProject(options.dir ?? ".");
    link = readLink(project.directory);
  } catch {}
  const provider = providerOrFail(options.provider ?? link?.provider ?? DEFAULT_PROVIDER.id);
  tokenAuth(provider);
  let instance = options.url ?? link?.url ?? provider.target.fixed;
  if (!instance) {
    if (!interactive) fail(`Pass --url, the address of your ${provider.name}.`);
    instance = unwrap(
      await p.text({ message: provider.target.label, placeholder: provider.target.placeholder }),
    );
  }
  try {
    return { provider, instance: provider.target.normalize(instance) };
  } catch (error) {
    fail((error as Error).message);
  }
}

/** `dstack deploy login`: check and save an API key. */
export async function deployLogin(
  options: DeployDirOptions & { provider?: string; url?: string; token?: string; yes?: boolean },
) {
  const interactive = isInteractive(options.yes);
  intro("Deploy login");
  const { provider, instance } = await loginTarget(options, interactive);
  const auth = tokenAuth(provider);
  let token = options.token ?? (options.yes ? process.env[auth.env] : undefined);
  if (!token) {
    if (!interactive) fail(`Pass --token or set ${auth.env}.`);
    token = await askToken(provider, instance);
  }
  await login(provider, instance, token);
  p.outro(pc.green("Done"));
}

/** `dstack deploy logout`: remove a saved API key. */
export async function deployLogout(options: DeployDirOptions & { provider?: string; url?: string }) {
  const { provider, instance } = await loginTarget(options, isInteractive(false));
  if (deleteToken(provider.id, instance)) p.log.success(`Removed the ${provider.name} key for ${instance}.`);
  else p.log.info(`There was no saved ${provider.name} key for ${instance}.`);
}

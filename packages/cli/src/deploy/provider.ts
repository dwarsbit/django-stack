/**
 * Deploy providers: hosting platforms `dstack deploy` talks to. The commands
 * only use this interface, so a new platform is a new provider and an entry
 * in PROVIDERS, without changes to the commands.
 */

export type DeploymentStatus = "queued" | "building" | "finished" | "failed" | "cancelled";

export interface LogLine {
  text: string;
  stderr: boolean;
}

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  commit?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
  /** A link to the deployment in the platform's UI. */
  url?: string;
  log: LogLine[];
}

export type AppState = "running" | "degraded" | "stopped" | "unknown";

export interface AppStatus {
  state: AppState;
  /** The platform's own words for the state, such as running:healthy. */
  detail: string;
  domains: string[];
  /** The git branch the platform deploys. */
  branch?: string;
  /** A link to the application in the platform's UI. */
  url?: string;
}

/** Where a project deploys: saved in `.dstack/deploy.json`, without secrets. */
export interface DeployLink {
  provider: string;
  /** The target: a platform instance such as https://coolify.example.com, or a server. */
  url: string;
  /** Provider-specific ids, such as the project, environment and application, or a directory. */
  project: string;
  environment: string;
  application: string;
  /** The project directory, set when the link is read from it; not saved. */
  directory?: string;
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Asks the user, or fails with a one-line reason when the CLI may not ask. */
export interface Ask {
  interactive: boolean;
  select<T>(message: string, choices: Choice<T>[], initial?: T): Promise<T>;
  text(message: string, options?: { placeholder?: string; initial?: string }): Promise<string>;
  confirm(message: string, initial?: boolean): Promise<boolean>;
  /** Asks for a secret without showing it; absent where the CLI may not ask. */
  password?(message: string): Promise<string>;
  /** Reports progress, such as "Created the project". */
  step(message: string): void;
}

export interface SetupContext {
  ask: Ask;
  /** The project directory. */
  directory: string;
  /** The project name, from compose.yaml. */
  name: string;
  /** The https URL of the git repository; set for providers that build from the remote. */
  repository?: string;
  branch: string;
  /** The site's domain, from SITE_URL in .env.production. */
  domain: string;
  /** The variables to give the application. */
  env: Record<string, string>;
  /** Provider flags from the command line, such as server or project. */
  options: Record<string, string | undefined>;
}

/** A provider connected to one target. */
export interface ProviderClient {
  /** Checks the key; returns the platform's version. */
  verify(): Promise<string>;
  /** Creates the application on the platform and gives it the variables. */
  setup(context: SetupContext): Promise<Omit<DeployLink, "provider" | "url">>;
  pushEnv(link: DeployLink, env: Record<string, string>): Promise<void>;
  /** Starts a deploy of the project in `directory`; returns its id. */
  deploy(link: DeployLink, options: { force: boolean; directory: string }): Promise<string>;
  deployment(link: DeployLink, id: string): Promise<Deployment>;
  /** The newest deployments first. */
  deployments(link: DeployLink, limit: number): Promise<Deployment[]>;
  status(link: DeployLink): Promise<AppStatus>;
  /**
   * Runs an earlier deploy again (`to`, or the one before the running one);
   * returns the new deploy's id. Only providers that keep releases have it.
   */
  rollback?(link: DeployLink, to?: string): Promise<string>;
}

export interface ProviderFlag {
  /** The option key, such as server for --server. */
  name: string;
  description: string;
}

/** How the CLI gets in: an API key it saves, or the user's own SSH keys and config. */
export type ProviderAuth =
  | {
      kind: "token";
      /** The environment variable that overrides the saved API key. */
      env: string;
      /** Where to create an API key, and which permissions it needs. */
      help(url: string): string;
    }
  | { kind: "ssh" };

/** What `--url` names for a provider. */
export interface ProviderTarget {
  /** Such as "Coolify URL" or "Server". */
  label: string;
  placeholder: string;
  /** The only target, for a platform with one API; the CLI does not ask for --url. */
  fixed?: string;
  /** Returns the canonical form, or throws with a one-line reason. */
  normalize(value: string): string;
}

export interface DeployProvider {
  id: string;
  name: string;
  auth: ProviderAuth;
  /**
   * What a deploy builds: the branch on the git remote (so push first), or
   * the local commit, which the CLI uploads (so commit first).
   */
  source: "remote" | "local";
  target: ProviderTarget;
  /** Variables the platform needs on top of .env.production. */
  platformEnv: Record<string, string>;
  /** The flags of `deploy setup` this provider reads. */
  setupFlags: ProviderFlag[];
  /** Setup prints the DNS record to add itself. */
  printsDns?: boolean;
  /** Connects to a target; token providers get the API key. */
  connect(target: string, token?: string): ProviderClient;
}

/** The target of a platform with a web API and an API key. */
export function urlTarget(name: string, placeholder: string): ProviderTarget {
  return { label: `${name} URL`, placeholder, normalize: normalizeUrl };
}

/** Normalizes an instance URL: https by default, no trailing slash or path. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`${value} is not a URL. Enter one such as https://coolify.example.com.`);
  }
  return `${parsed.protocol}//${parsed.host}`;
}

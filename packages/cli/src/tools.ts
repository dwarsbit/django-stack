import { execFileSync } from "node:child_process";

export interface Check {
  name: string;
  ok: boolean;
  /** Not a failure: the check could not run or only warns. */
  warning?: boolean;
  detail?: string;
  /** How to fix a failed check, one line each. */
  help?: string[];
}

/** The oldest Node.js the frontend and the CLI run on. */
export const MIN_NODE = "22";
/** The oldest Python the backend runs on. */
export const MIN_PYTHON = "3.12";

export type Run = (cmd: string, args: string[], cwd?: string) => string | undefined;

/** Runs a command and returns its trimmed output, or undefined when it fails. */
export const run: Run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
};

/** The first `x.y.z` version in a text, such as `Python 3.13.1` or `v22.11.0`. */
export function parseVersion(text: string | undefined): string | undefined {
  return text?.match(/(\d+)\.(\d+)(?:\.(\d+))?/)?.[0];
}

/** Whether version `a` is at least `b`, compared by number per part. */
export function atLeast(a: string, b: string): boolean {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

type Platform = NodeJS.Platform;

function dockerHelp(platform: Platform): string[] {
  if (platform === "darwin")
    return [
      "Install Docker Desktop: brew install --cask docker",
      "or https://docs.docker.com/desktop/setup/install/mac-install/",
    ];
  if (platform === "win32")
    return [
      "Install Docker Desktop: winget install Docker.DockerDesktop",
      "or https://docs.docker.com/desktop/setup/install/windows-install/",
    ];
  return ["Install Docker Engine and the Compose plugin: https://docs.docker.com/engine/install/"];
}

function dockerStartHelp(platform: Platform): string[] {
  if (platform === "linux") return ["Start it: sudo systemctl start docker"];
  return ["Open Docker Desktop and wait until it says it is running."];
}

function nodeHelp(platform: Platform): string[] {
  const install =
    platform === "darwin"
      ? "brew install fnm"
      : platform === "win32"
        ? "winget install Schniz.fnm"
        : "curl -fsSL https://fnm.vercel.app/install | bash";
  return [
    `Install it with fnm: ${install}, then fnm install ${MIN_NODE}`,
    "or https://nodejs.org/en/download",
  ];
}

function pythonHelp(platform: Platform, hasUv: boolean): string[] {
  const python = "uv python install 3.13";
  if (hasUv) return [`Install it with uv: ${python}`];
  const install =
    platform === "darwin"
      ? "brew install uv"
      : platform === "win32"
        ? "winget install astral-sh.uv"
        : "curl -LsSf https://astral.sh/uv/install.sh | sh";
  return [
    `Install uv: ${install}, then ${python}`,
    "or https://docs.astral.sh/uv/getting-started/installation/",
  ];
}

function pythonVersion(runCommand: Run): string | undefined {
  for (const [cmd, args] of [
    ["python3", ["--version"]],
    ["python", ["--version"]],
    ["py", ["-3", "--version"]],
  ] as const) {
    const version = parseVersion(runCommand(cmd, [...args]));
    if (version) return version;
  }
  return undefined;
}

export interface ToolOptions {
  run?: Run;
  platform?: Platform;
}

/** Docker and Docker Compose, which run the project. */
export function checkDocker({
  run: runCommand = run,
  platform = process.platform,
}: ToolOptions = {}): Check[] {
  const client = parseVersion(runCommand("docker", ["--version"]));
  if (!client) return [{ name: "Docker is installed", ok: false, help: dockerHelp(platform) }];
  const server = runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  const checks: Check[] = [
    {
      name: "Docker is running",
      ok: Boolean(server),
      detail: server ? `Docker ${server}` : `Docker ${client} is installed but not running.`,
      help: server ? undefined : dockerStartHelp(platform),
    },
  ];
  const compose = runCommand("docker", ["compose", "version", "--short"]);
  checks.push({
    name: "Docker Compose v2",
    ok: Boolean(compose),
    detail: compose ? `Compose ${compose}` : undefined,
    help: compose
      ? undefined
      : ["Docker Compose v2 is part of Docker Desktop and the docker-compose-plugin package."],
  });
  return checks;
}

/**
 * Node.js and Python, which you need to work on the frontend and the backend
 * outside the containers. They only warn: the project runs in Docker without them.
 */
export function checkDevTools({
  run: runCommand = run,
  platform = process.platform,
}: ToolOptions = {}): Check[] {
  const checks: Check[] = [];
  const node = parseVersion(runCommand("node", ["--version"]));
  const nodeOk = Boolean(node && atLeast(node, MIN_NODE));
  checks.push({
    name: `Node.js ${MIN_NODE} or later`,
    ok: nodeOk,
    warning: !nodeOk,
    detail: node ? `Node.js ${node}` : "Node.js was not found.",
    help: nodeOk ? undefined : nodeHelp(platform),
  });
  const python = pythonVersion(runCommand);
  const pythonOk = Boolean(python && atLeast(python, MIN_PYTHON));
  checks.push({
    name: `Python ${MIN_PYTHON} or later`,
    ok: pythonOk,
    warning: !pythonOk,
    detail: python ? `Python ${python}` : "Python was not found.",
    help: pythonOk ? undefined : pythonHelp(platform, Boolean(runCommand("uv", ["--version"]))),
  });
  return checks;
}

/** Every tool a project needs on this computer. */
export function checkTools(options: ToolOptions = {}): Check[] {
  return [...checkDocker(options), ...checkDevTools(options)];
}

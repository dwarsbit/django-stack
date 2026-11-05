import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { command, has } from "./ui";
import { PACKAGE_NAME } from "./update-check";

/** The name of the installed command. */
export const BIN = "dstack";

export type Runner = "npm" | "pnpm" | "bun";

const normalize = (value: string) => decodeURIComponent(value).replaceAll("\\", "/");

/** Whether a path is in the temporary cache of npx, pnpm dlx or bunx. */
function isTemporary(path: string): boolean {
  return (
    path.includes("/_npx/") || path.includes("/dlx/") || path.includes("/dlx-") || path.includes("/bunx-")
  );
}

/**
 * The package manager that runs this copy from its temporary cache (npx,
 * pnpm dlx or bunx), or undefined for an installed copy.
 */
export function temporaryRunner(location: string = import.meta.url): Runner | undefined {
  const path = normalize(location);
  if (path.includes("/_npx/")) return "npm";
  if (path.includes("/dlx/") || path.includes("/dlx-")) return "pnpm";
  if (path.includes("/bunx-")) return "bun";
  return undefined;
}

/** Whether `dstack` is on the `PATH`, leaving out the temporary directories npx and friends add. */
export function isOnPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  const names = platform === "win32" ? [`${BIN}.cmd`, `${BIN}.exe`, `${BIN}.ps1`, BIN] : [BIN];
  const path = env.PATH ?? env.Path ?? "";
  return path
    .split(platform === "win32" ? ";" : delimiter)
    .filter((dir) => dir && !isTemporary(normalize(dir)) && !normalize(dir).endsWith("node_modules/.bin"))
    .some((dir) => names.some((name) => existsSync(join(dir, name))));
}

/** The command that installs the CLI globally with a package manager. */
export function installCommand(runner: Runner = "npm"): string[] {
  if (runner === "pnpm") return ["pnpm", "add", "--global", `${PACKAGE_NAME}@latest`];
  if (runner === "bun") return ["bun", "add", "--global", `${PACKAGE_NAME}@latest`];
  return ["npm", "i", "-g", `${PACKAGE_NAME}@latest`];
}

/** How to run the CLI from a shell: `dstack` when it is installed, otherwise through the runner. */
export function selfCommand(
  location: string = import.meta.url,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const runner = temporaryRunner(location);
  if (!runner || isOnPath(env)) return BIN;
  if (runner === "pnpm") return `pnpm dlx ${PACKAGE_NAME}`;
  if (runner === "bun") return `bunx ${PACKAGE_NAME}`;
  return `npx ${PACKAGE_NAME}`;
}

/** `$XDG_CONFIG_HOME/django-stack/config.json`, or under `~/.config` (`%APPDATA%` on Windows). */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base =
    env.XDG_CONFIG_HOME || (process.platform === "win32" && env.APPDATA) || join(homedir(), ".config");
  return join(base, "django-stack", "config.json");
}

/** What happened the last time the CLI offered to install itself. */
export type InstallAnswer = "installed" | "declined" | "failed";

export function readInstallAnswer(path = defaultConfigPath()): InstallAnswer | undefined {
  try {
    const answer = JSON.parse(readFileSync(path, "utf8")).globalInstall;
    if (answer === "installed" || answer === "declined" || answer === "failed") return answer;
  } catch {}
  return undefined;
}

export function saveInstallAnswer(answer: InstallAnswer, path = defaultConfigPath()) {
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...config, globalInstall: answer }, null, 2)}\n`);
  } catch {}
}

export interface OfferContext {
  runner: Runner | undefined;
  onPath: boolean;
  answer: InstallAnswer | undefined;
  interactive: boolean;
  env: NodeJS.ProcessEnv;
}

/** Offer the install only once, only to npx users without `dstack`, and never in CI or scripts. */
export function shouldOffer({ runner, onPath, answer, interactive, env }: OfferContext): boolean {
  if (!runner || onPath || answer || !interactive) return false;
  if (env.CI && env.CI !== "0" && env.CI !== "false") return false;
  const off = env.DJANGO_STACK_NO_INSTALL_PROMPT;
  return !off || off === "0";
}

/** A one-line reason and a fix for a failed install, from the package manager's output. */
export function explainFailure(runner: Runner, output: string): string {
  const manual = command(installCommand(runner).join(" "));
  if (/ERR_PNPM_NO_GLOBAL_BIN_DIR/.test(output))
    return `pnpm has no global bin directory yet. Run ${command("pnpm setup")}, open a new terminal and run ${manual}.`;
  if (/EACCES|EPERM|permission denied/i.test(output))
    return runner === "npm"
      ? `No permission to write to npm's global directory. Give npm a directory in your home (https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally), then run ${manual}.`
      : `No permission to write to ${runner}'s global directory. Fix that, then run ${manual}.`;
  const last = output.trim().split("\n").pop()?.trim();
  return `${last ? `${last} ` : ""}Run ${manual} to try again.`;
}

function run(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const [cmd, ...rest] = args as [string, ...string[]];
    let output = "";
    // On Windows, npm and pnpm are .cmd scripts; the arguments are fixed.
    const child = spawn(cmd, rest, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

let offered = false;

/**
 * Ask to install `dstack` globally when the CLI runs through npx, pnpm dlx
 * or bunx. Asks once per machine, remembers the answer, and never fails the
 * command. Returns whether it installed.
 */
export async function offerGlobalInstall(): Promise<boolean> {
  if (offered) return false;
  offered = true;
  const runner = temporaryRunner();
  const context: OfferContext = {
    runner,
    onPath: isOnPath(),
    answer: readInstallAnswer(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    env: process.env,
  };
  if (!runner || !shouldOffer(context)) return false;

  const args = installCommand(runner);
  const yes = await p.confirm({
    message: `Install ${command(BIN)} globally, so you can run ${command(`${BIN} <command>`)} instead of npx?`,
    initialValue: true,
  });
  if (yes !== true) {
    saveInstallAnswer("declined");
    p.log.message(`You won't be asked again. Install it any time with ${command(args.join(" "))}`);
    return false;
  }
  if (!has(runner)) {
    saveInstallAnswer("failed");
    p.log.warn(`${runner} is not on your PATH. Install ${runner}, then run ${command(args.join(" "))}`);
    return false;
  }

  const spinner = p.spinner();
  spinner.start(`Installing with ${command(args.join(" "))}`);
  const result = await run(args);
  if (!result.ok) {
    saveInstallAnswer("failed");
    spinner.error(`Couldn't install ${BIN}`);
    p.log.warn(explainFailure(runner, result.output));
    return false;
  }
  saveInstallAnswer("installed");
  spinner.stop(`Installed ${command(BIN)}`);
  if (!isOnPath())
    p.log.warn(
      `${BIN} is installed, but ${runner}'s global bin directory is not on your PATH yet. ${
        runner === "pnpm" ? `Run ${command("pnpm setup")} and o` : "O"
      }pen a new terminal.`,
    );
  return true;
}

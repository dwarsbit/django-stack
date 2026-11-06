import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  BIN,
  explainFailure,
  installation,
  installCommand,
  type Runner,
  runInstall,
} from "../global-install";
import { command, fail, has, intro } from "../ui";
import { fetchLatestVersion, isNewer } from "../update-check";
import { CLI_VERSION, PACKAGE_NAME } from "../version";

/** The command each package manager runs a package with, without installing it. */
const RUN_WITHOUT_INSTALL: Record<Runner, string> = {
  npm: "npx",
  pnpm: "pnpm dlx",
  bun: "bunx",
  yarn: "yarn dlx",
};

/**
 * The npm prefix this copy is installed in, such as `/usr/local` for
 * `/usr/local/lib/node_modules/@django-stack/cli`, so the update replaces this
 * copy even when another Node.js version's npm comes first on the `PATH`.
 */
export function npmPrefix(location: string = import.meta.url): string | undefined {
  if (!location.startsWith("file:")) return undefined;
  const path = fileURLToPath(location);
  const match = /^(.+)\/lib\/node_modules\/@django-stack\/cli\//.exec(path);
  return match?.[1];
}

/** The version of the `dstack` on the `PATH`, or undefined when there is none. */
function versionOnPath(): string | undefined {
  try {
    // On Windows, dstack is a .cmd script; the arguments are fixed.
    return execFileSync(BIN, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, DJANGO_STACK_NO_UPDATE_CHECK: "1" },
    }).trim();
  } catch {
    return undefined;
  }
}

/** Update the installed CLI to the latest version on npm, with the package manager that installed it. */
export async function selfUpdate() {
  intro("Self-update");
  const install = installation();
  if (install.kind === "checkout")
    fail(`This ${BIN} runs from a DjangoStack checkout. Update it with git pull and pnpm build.`);
  if (install.kind === "temporary") {
    const runWith = RUN_WITHOUT_INSTALL[install.runner];
    fail(
      `This ${BIN} runs through ${runWith} and is not installed. Run ${runWith} ${PACKAGE_NAME}@latest for the latest version, or install it with ${installCommand(install.runner).join(" ")}.`,
    );
  }

  const { runner } = install;
  const spinner = p.spinner();
  spinner.start("Checking npm for the latest version");
  let latest: string;
  try {
    latest = await fetchLatestVersion({ timeout: 10_000 });
  } catch (error) {
    spinner.error("Couldn't check npm");
    fail(`Couldn't reach the npm registry: ${(error as Error).message}`);
  }
  if (!isNewer(latest, CLI_VERSION)) {
    spinner.stop(`${BIN} ${CLI_VERSION} is the latest version`);
    p.outro(pc.green("Nothing to update"));
    return;
  }
  spinner.stop(`Version ${pc.green(pc.bold(latest))} is available`);

  const prefix = runner === "npm" ? npmPrefix() : undefined;
  const args = prefix ? [...installCommand(runner), "--prefix", prefix] : installCommand(runner);
  if (!has(runner))
    fail(`${runner} installed ${BIN} but is not on your PATH. Run ${args.join(" ")} yourself.`);
  spinner.start(`Updating with ${command(args.join(" "))}`);
  const result = await runInstall(args);
  if (!result.ok) {
    spinner.error(`Couldn't update ${BIN}`);
    fail(explainFailure(runner, result.output));
  }
  spinner.stop(`Updated ${BIN} ${pc.dim(CLI_VERSION)} ${pc.dim("→")} ${pc.green(pc.bold(latest))}`);

  const onPath = versionOnPath();
  if (onPath && onPath !== latest)
    p.log.warn(
      `The ${command(BIN)} on your PATH is still ${onPath}: another install comes first. Remove it, or update it with its own package manager.`,
    );
  p.outro(pc.green("Done"));
}

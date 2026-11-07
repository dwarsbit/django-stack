import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { applyStack, SWITCHABLE, setManifestPreset } from "../config";
import { runDoctor } from "../doctor";
import { setEnvValues } from "../env";
import { chooseFreePorts, DEV_PORTS, describeMove, envPorts, portValues } from "../ports";
import { productionEnv } from "../production";
import {
  activeProject,
  CAPTCHA_APP,
  compose,
  composeOutput,
  type Project,
  projectStack,
  projectUrls,
  RUN_DOMAIN,
  RUN_ENV,
  readLocalRun,
  readProject,
  runningServices,
} from "../project";
import { frontendPackageManager, setNotificationsApp, updateFrontendLock } from "../scaffold";
import { encodePreset, PROMPT_ORDER, type Stack, stackOption } from "../stack";
import { dockerNotRunning, dockerRunning } from "../tools";
import { command, fail, has, intro, isInteractive, logCheck, secret, unwrap, url } from "../ui";
import { choices } from "./init";

export interface DirectoryOptions {
  dir?: string;
}

function open(options: DirectoryOptions): Project {
  if (!has("docker", ["compose", "version"]))
    fail("Docker Compose v2 was not found. Install Docker: https://docs.docker.com/get-docker/");
  if (!dockerRunning()) fail(dockerNotRunning());
  try {
    return readProject(options.dir ?? ".");
  } catch (error) {
    fail((error as Error).message);
  }
}

function urlsNote(project: Project, title: string) {
  const urls = projectUrls(project);
  const width = Math.max(...urls.map((item) => item.label.length));
  p.note(urls.map((item) => `${pc.bold(item.label.padEnd(width))}  ${url(item.url)}`).join("\n"), title);
}

const tty = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** Exit with the status of a command, but treat Ctrl+C (130) as a normal stop. */
function exitWith(status: number) {
  if (status !== 0 && status !== 130) process.exitCode = status;
}

/** Writes `.env.run` for the local production run of a development project, once. */
function ensureRunEnv(project: Project): Project {
  const path = join(project.directory, RUN_ENV);
  if (!existsSync(path)) {
    const result = productionEnv(readFileSync(join(project.directory, ".env"), "utf8"), {
      domain: RUN_DOMAIN,
      emailUrl: "console://",
      // Its own data on this machine, never the server's external database.
      bundledDatabase: true,
    });
    writeFileSync(path, result.text, { mode: 0o600 });
    p.log.success(
      `Wrote ${pc.bold(RUN_ENV)}: the prod profile at ${url(`https://${RUN_DOMAIN}`)}, with its own secrets and data.`,
    );
    p.log.message(`Admin user ${secret("admin")}, password ${secret(result.adminPassword)}`);
  }
  const run = readLocalRun(project);
  if (!run) fail(`Could not read ${RUN_ENV}.`);
  return run;
}

/** `dstack run`: the prod profile in the background, on a server or locally at https://site.localhost. */
export async function run(options: DirectoryOptions & { build: boolean }) {
  const base = open(options);
  intro("Run");
  const project = base.prod ? base : ensureRunEnv(base);
  const args = ["up", "--detach", "--wait", "--wait-timeout", "300"];
  if (options.build) args.push("--build");
  if (compose(project, args) !== 0) fail(`The project did not start. See ${command("dstack logs")}.`);
  urlsNote(project, "Running");
  if (project.localRun)
    p.log.message(
      pc.dim(
        `Caddy signs ${RUN_DOMAIN} with its own local CA, so the browser warns once. The admin password is in ${RUN_ENV}.`,
      ),
    );
  p.outro(`Stop it with ${command("dstack stop")}, follow the logs with ${command("dstack logs")}`);
}

/**
 * Moves the development services to free ports when theirs are in use, in
 * `.env`, unless the project already runs. compose.yaml from before the
 * *_PORT variables has fixed ports, so it can only say which one is in use.
 */
async function freeDevPorts(project: Project): Promise<Project> {
  if (runningServices(project).length) return project;
  const { ports, moves, stuck } = await chooseFreePorts(project.env, project.profiles);
  const [blocked] = stuck;
  if (blocked)
    fail(`Port ${envPorts(project.env)[blocked.name]} of the ${blocked.label} is in use. Stop what uses it.`);
  if (!moves.length) return project;
  const composeText = readFileSync(join(project.directory, "compose.yaml"), "utf8");
  for (const move of moves) {
    const item = DEV_PORTS.find((candidate) => candidate.label === move.label);
    if (item && !composeText.includes(`\${${item.name}`))
      fail(
        `Port ${move.from} of the ${move.label} is in use. Stop what uses it, or publish another port in compose.yaml.`,
      );
  }
  const envPath = join(project.directory, ".env");
  writeFileSync(envPath, setEnvValues(readFileSync(envPath, "utf8"), portValues(project.env, ports)), {
    mode: 0o600,
  });
  for (const move of moves) p.log.info(`${describeMove(move)} Saved in .env.`);
  return readProject(project.directory);
}

/** `dstack dev`: the dev profile in the foreground, with hot reload. */
export async function dev(options: DirectoryOptions & { build: boolean }) {
  let project = open(options);
  if (project.prod) fail(`This .env runs the prod profile. Use ${command("dstack run")}.`);
  intro("Develop");
  project = await freeDevPorts(project);
  urlsNote(project, "Starting");
  const reloads = project.services.frontend ? "backend/ and frontend/" : "backend/";
  p.log.message(pc.dim(`Changes in ${reloads} reload. Press Ctrl+C to stop.`));
  exitWith(compose(project, ["up", ...(options.build ? ["--build"] : [])]));
}

/** `dstack stop`: stop the containers of the project and of its local run; volumes and data stay. */
export async function stop(options: DirectoryOptions) {
  const project = open(options);
  for (const target of [project, readLocalRun(project)]) {
    if (target && compose(target, ["down"]) !== 0) fail("The project did not stop.");
  }
}

/** `dstack logs [service...]`. */
export async function logs(
  services: string[],
  options: DirectoryOptions & { follow: boolean; tail?: string },
) {
  const project = activeProject(open(options));
  const args = ["logs", ...(options.follow ? ["--follow"] : [])];
  if (options.tail) args.push("--tail", options.tail);
  exitWith(compose(project, [...args, ...services]));
}

/** `exec` in a running service, otherwise a one-off container. */
function inService(project: Project, service: string, args: string[], interactive = tty()): string[] {
  const noTty = interactive ? [] : ["-T"];
  if (runningServices(project).includes(service)) return ["exec", ...noTty, service, ...args];
  return ["run", "--rm", ...noTty, service, ...args];
}

/** `dstack manage <args...>`: Django's manage.py in the backend container. */
export async function manage(args: string[], options: DirectoryOptions) {
  const project = activeProject(open(options));
  exitWith(compose(project, inService(project, project.services.backend, ["python", "manage.py", ...args])));
}

/** `dstack status`: the containers, then the database, cache, worker and backup checks. */
export async function status(options: DirectoryOptions) {
  const project = activeProject(open(options));
  if (!runningServices(project).includes(project.services.backend))
    fail(`The ${project.services.backend} service is not running.`);
  compose(project, ["ps"]);
  exitWith(compose(project, ["exec", "-T", project.services.backend, "python", "manage.py", "health"]));
}

/** `dstack shell`: Django's shell in the backend container. */
export async function shell(options: DirectoryOptions) {
  return manage(["shell"], options);
}

/**
 * The project and how to run a backup command: in the prod worker, on a
 * server or the local run, or the `backup` service of projects from 0.1.
 * Without a running worker (tasks off, TASK_WORKERS=0) in a one-off worker
 * container, while the backend runs.
 */
function backupProject(options: DirectoryOptions): { project: Project; run: string[] } {
  const project = activeProject(open(options));
  if (!project.prod)
    fail(`Backups run in the prod profile: on the server, or locally after ${command("dstack run")}.`);
  const running = runningServices(project);
  const service = ["backup", project.services.worker].find((name) => running.includes(name));
  if (service) return { project, run: ["exec", service] };
  if (project.env.TASK_WORKERS === "0" && running.includes(project.services.backend))
    return { project, run: ["run", "--rm", "--no-deps", project.services.worker] };
  fail(
    `The ${project.services.worker} service is not running. Start the project with ${command("dstack run")}.`,
  );
}

/** `dstack backup`: back up the database and the media now, or list the backups. */
export async function backup(options: DirectoryOptions & { list?: boolean; media: boolean }) {
  const { project, run } = backupProject(options);
  const args = ["python", "manage.py", "backup_database"];
  if (options.list) args.push("--list");
  else if (!options.media) args.push("--no-media");
  exitWith(compose(project, [run[0] as string, "-T", ...run.slice(1), ...args]));
}

/** The management command and its options for `dstack restore`. */
export function restoreArgs(name: string, options: { yes?: boolean; media?: boolean }): string[] {
  const yes = options.yes ? ["--yes"] : [];
  if (name.endsWith(".media.tar.gz")) return ["python", "manage.py", "restore_media", name, ...yes];
  return ["python", "manage.py", "restore_database", name, ...(options.media ? ["--media"] : []), ...yes];
}

/** `dstack restore <backup>`: restore a database dump, with --media its media too, or a media archive. */
export async function restore(name: string, options: DirectoryOptions & { yes?: boolean; media?: boolean }) {
  const { project, run } = backupProject(options);
  const args = restoreArgs(name, options);
  if (!options.yes && !tty()) fail("Pass --yes to restore without a terminal.");
  exitWith(compose(project, [run[0] as string, ...(options.yes ? ["-T"] : []), ...run.slice(1), ...args]));
}

/** `dstack types`: the OpenAPI schema from the backend, and the frontend's types from it. */
export async function types(options: DirectoryOptions) {
  const project = open(options);
  if (project.prod) fail("Generate the types in development, then commit them.");
  intro("Types");
  const schema = [
    "python",
    "manage.py",
    "generateschema",
    "--generator_class",
    "headless.rest.schema.SchemaGenerator",
    "--format",
    "openapi-json",
    "--file",
    "openapi.json",
  ];
  if (compose(project, inService(project, project.services.backend, schema, false)) !== 0)
    fail("The backend could not write its schema.");
  // Headless: the schema is the result, for your own frontend's client.
  if (!project.services.frontend) {
    p.outro(`Wrote ${pc.bold("backend/openapi.json")}`);
    return;
  }
  const generate = ["npx", "headless", "generate", "--file", "/schema.json", "--out", "src/lib/headless.ts"];
  const mount = ["-v", "./backend/openapi.json:/schema.json:ro"];
  if (
    compose(project, ["run", "--rm", "--no-deps", "-T", ...mount, project.services.frontend, ...generate]) !==
    0
  )
    fail("The frontend could not generate the types.");
  p.outro(`Wrote ${pc.bold("frontend/src/lib/headless.ts")}`);
}

interface Step {
  name: string;
  service: "backend" | "frontend";
  args: string[];
  /** Only with the dev images, which have the dev tools. */
  devOnly?: boolean;
}

/** The code checks of `dstack check`. */
export function checkSteps(project: Project, tests: boolean): Step[] {
  const steps: Step[] = [
    {
      name: project.prod ? "Django deploy checks" : "Django system checks",
      service: "backend",
      args: project.prod
        ? ["python", "manage.py", "check", "--deploy", "--fail-level", "WARNING"]
        : ["python", "manage.py", "check"],
    },
    {
      name: "Migrations are up to date",
      service: "backend",
      args: ["python", "manage.py", "makemigrations", "--check", "--dry-run"],
    },
    { name: "Ruff", service: "backend", args: ["ruff", "check", "."], devOnly: true },
    { name: "Frontend check", service: "frontend", args: ["npm", "run", "--silent", "check"], devOnly: true },
  ];
  if (tests) {
    steps.push(
      { name: "Backend tests", service: "backend", args: ["pytest", "-q"], devOnly: true },
      { name: "Frontend tests", service: "frontend", args: ["npm", "test", "--silent"], devOnly: true },
    );
  }
  return steps.filter(
    (step) => !(step.devOnly && project.prod) && (step.service !== "frontend" || project.services.frontend),
  );
}

/** `dstack check`: the doctor's checks, Django's checks, the linters and, with --tests, the tests. */
export async function check(options: DirectoryOptions & { tests?: boolean }) {
  const base = open(options);
  const project = activeProject(base);
  intro("Check");
  let failed = 0;
  const spinner = p.spinner();
  if (!project.localRun) {
    spinner.start("Checking the setup");
    const doctorChecks = await runDoctor(project.directory);
    spinner.clear();
    for (const item of doctorChecks) {
      logCheck(item);
      if (!item.ok && !item.warning) failed++;
    }
  }
  const running = runningServices(project);
  for (const step of checkSteps(project, Boolean(options.tests))) {
    const service = project.services[step.service] as string;
    const args = running.includes(service)
      ? ["exec", "-T", service, ...step.args]
      : ["run", "--rm", "-T", ...(step.service === "frontend" ? ["--no-deps"] : []), service, ...step.args];
    spinner.start(step.name);
    const result = composeOutput(project, args);
    if (result.status === 0) {
      spinner.stop(step.name);
      continue;
    }
    failed++;
    spinner.error(pc.red(step.name));
    if (result.output) p.log.message(pc.dim(result.output.split("\n").slice(-40).join("\n")));
  }
  if (failed) {
    p.outro(pc.red(`${failed} ${failed === 1 ? "check" : "checks"} failed`));
    process.exitCode = 1;
    return;
  }
  p.outro(pc.green("All checks passed"));
}

/** The name of the frontend's node_modules volume, which hides new packages after a rebuild. */
function nodeModulesVolume(project: Project): string | undefined {
  const result = composeOutput(project, ["config", "--format", "json"]);
  if (result.status !== 0) return undefined;
  try {
    return JSON.parse(result.output).volumes?.frontend_node_modules?.name;
  } catch {
    return undefined;
  }
}

/** `dstack update`: newer images, newer DjangoStack packages, and a restart of what was running. */
export async function update(
  options: DirectoryOptions & { all?: boolean; cache: boolean; restart: boolean },
) {
  const project = open(options);
  intro("Update");
  const targets = [project, readLocalRun(project)].filter((target): target is Project => Boolean(target));
  const running = targets.filter((target) => runningServices(target).length > 0);

  const lock = join(project.directory, "backend", "uv.lock");
  if (existsSync(lock) && has("uv")) {
    const args = options.all ? ["lock", "--upgrade"] : ["lock", "--upgrade-package", "django-stack"];
    const result = spawnSync("uv", args, { cwd: join(project.directory, "backend"), stdio: "inherit" });
    if (result.status !== 0) fail("uv could not update backend/uv.lock.");
    p.log.success(options.all ? "Updated backend/uv.lock" : "Updated django-stack in backend/uv.lock");
  } else if (existsSync(lock)) {
    p.log.warn("uv is not installed, so backend/uv.lock stays as it is: https://docs.astral.sh/uv/");
  }
  if (frontendPackageManager(project.directory)) {
    const lockfile = updateFrontendLock(project.directory, options.all);
    if (!lockfile) fail("The package manager could not update the frontend's lockfile.");
    p.log.success(
      options.all
        ? `Updated frontend/${lockfile}`
        : `Updated the @django-stack packages in frontend/${lockfile}`,
    );
  }

  for (const target of targets) {
    if (compose(target, ["pull", "--ignore-buildable"]) !== 0) fail("Pulling the images failed.");
    const build = ["build", "--pull", ...(options.cache ? [] : ["--no-cache"])];
    if (compose(target, build) !== 0) fail("Building the images failed.");
  }

  const volume = project.prod || !project.services.frontend ? undefined : nodeModulesVolume(project);
  if (volume && project.services.frontend) {
    // The volume keeps the old packages; the next start fills it from the new image.
    compose(project, ["rm", "--stop", "--force", project.services.frontend]);
    spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
  }

  if (options.restart && running.length) {
    for (const target of running) {
      if (compose(target, ["up", "--detach", "--wait", "--wait-timeout", "300"]) !== 0)
        fail(`The project did not start again. See ${command("dstack logs")}.`);
    }
    p.outro(pc.green("Updated and restarted"));
    return;
  }
  p.outro(pc.green(`Updated. Start it with ${command(project.prod ? "dstack run" : "dstack dev")}`));
}

export interface ConfigOptions extends DirectoryOptions {
  yes?: boolean;
  [key: string]: unknown;
  fromCli: (option: string) => boolean;
}

/** `dstack config`: change the stack options of an existing project. */
export async function config(options: ConfigOptions) {
  let project: Project;
  try {
    project = readProject(options.dir ?? ".");
  } catch (error) {
    fail((error as Error).message);
  }
  const interactive = isInteractive(options.yes);
  intro("Configure");
  const current = projectStack(project);
  const next = { ...current } as Record<string, string>;

  for (const key of PROMPT_ORDER) {
    if (options.fromCli(key)) next[key] = options[key] as string;
    else if (interactive && SWITCHABLE.includes(key)) {
      next[key] = unwrap(
        await p.select<string>({
          message: stackOption(key).message,
          initialValue: current[key],
          options: choices(key, next as Partial<Stack>),
        }),
      );
    }
  }

  if (next.analytics === "umami" && current.analytics !== "umami") {
    const compose = join(project.directory, "compose.yaml");
    if (!existsSync(compose) || !/^ {2}umami:/m.test(readFileSync(compose, "utf8")))
      fail("compose.yaml has no umami service. Add it as the analytics docs describe, then run this again.");
  }

  const settingsPath = join(project.directory, "backend", "config", "settings.py");
  if (next.captcha === "on" && current.captcha !== "on") {
    if (!existsSync(settingsPath) || !CAPTCHA_APP.test(readFileSync(settingsPath, "utf8")))
      fail(
        "The backend has no django_stack.contrib.captcha. Add it and the widget as the captcha docs describe, then run this again.",
      );
  }
  let settingsText: string | undefined;
  if (next.notifications !== current.notifications) {
    if (!existsSync(settingsPath)) fail("This project has no backend/config/settings.py.");
    try {
      settingsText = setNotificationsApp(readFileSync(settingsPath, "utf8"), next.notifications === "on");
    } catch (error) {
      fail((error as Error).message);
    }
  }

  const envPath = join(project.directory, ".env");
  let result: ReturnType<typeof applyStack>;
  try {
    result = applyStack(readFileSync(envPath, "utf8"), project.env, current, next as Stack);
  } catch (error) {
    fail((error as Error).message);
  }
  if (!result.changes.length) {
    p.outro("Nothing changed");
    return;
  }
  const envText = readFileSync(envPath, "utf8");
  if (result.env !== envText) writeFileSync(envPath, result.env, { mode: 0o600 });
  if (settingsText !== undefined) writeFileSync(settingsPath, settingsText);
  const manifestPath = join(project.directory, "package.json");
  if (existsSync(manifestPath))
    writeFileSync(
      manifestPath,
      setManifestPreset(readFileSync(manifestPath, "utf8"), encodePreset(next as Stack)),
    );
  for (const change of result.changes) p.log.success(change);
  if (result.env === envText && settingsText === undefined) p.outro(pc.green("Done"));
  else p.outro(`Restart to apply it: ${command("dstack stop")}, then ${command("dstack dev")}`);
}

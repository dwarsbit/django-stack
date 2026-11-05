import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { applyStack, SWITCHABLE, setManifestPreset } from "../config";
import { runDoctor } from "../doctor";
import { productionEnv } from "../production";
import {
  activeProject,
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
import { encodePreset, STACK_OPTIONS, type Stack, type StackKey, type StackValue } from "../stack";
import { command, fail, has, intro, isInteractive, secret, unwrap, url } from "../ui";

export interface DirectoryOptions {
  dir?: string;
}

function open(options: DirectoryOptions): Project {
  if (!has("docker", ["compose", "version"]))
    fail("Docker Compose v2 was not found. Install Docker: https://docs.docker.com/get-docker/");
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

/** `dstack dev`: the dev profile in the foreground, with hot reload. */
export async function dev(options: DirectoryOptions & { build: boolean }) {
  const project = open(options);
  if (project.prod) fail(`This .env runs the prod profile. Use ${command("dstack run")}.`);
  intro("Develop");
  urlsNote(project, "Starting");
  p.log.message(pc.dim("Changes in backend/ and frontend/ reload. Press Ctrl+C to stop."));
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

/** `dstack shell`: Django's shell in the backend container. */
export async function shell(options: DirectoryOptions) {
  return manage(["shell"], options);
}

/** The project that runs the backups: the prod profile, on a server or the local run. */
function backupProject(options: DirectoryOptions): Project {
  const project = activeProject(open(options));
  if (!project.prod)
    fail(`Backups run in the prod profile: on the server, or locally after ${command("dstack run")}.`);
  if (!runningServices(project).includes("backup"))
    fail(`The backup service is not running. Start the project with ${command("dstack run")}.`);
  return project;
}

/** `dstack backup`: back up the database and the media now, or list the backups. */
export async function backup(options: DirectoryOptions & { list?: boolean; media: boolean }) {
  const project = backupProject(options);
  const args = ["python", "manage.py", "backup_database"];
  if (options.list) args.push("--list");
  else if (!options.media) args.push("--no-media");
  exitWith(compose(project, ["exec", "-T", "backup", ...args]));
}

/** The management command and its options for `dstack restore`. */
export function restoreArgs(name: string, options: { yes?: boolean; media?: boolean }): string[] {
  const yes = options.yes ? ["--yes"] : [];
  if (name.endsWith(".media.tar.gz")) return ["python", "manage.py", "restore_media", name, ...yes];
  return ["python", "manage.py", "restore_database", name, ...(options.media ? ["--media"] : []), ...yes];
}

/** `dstack restore <backup>`: restore a database dump, with --media its media too, or a media archive. */
export async function restore(name: string, options: DirectoryOptions & { yes?: boolean; media?: boolean }) {
  const project = backupProject(options);
  const args = restoreArgs(name, options);
  if (!options.yes && !tty()) fail("Pass --yes to restore without a terminal.");
  exitWith(compose(project, ["exec", ...(options.yes ? ["-T"] : []), "backup", ...args]));
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
    { name: "Astro check", service: "frontend", args: ["npm", "run", "--silent", "check"], devOnly: true },
  ];
  if (tests) {
    steps.push(
      { name: "Backend tests", service: "backend", args: ["pytest", "-q"], devOnly: true },
      { name: "Frontend tests", service: "frontend", args: ["npm", "test", "--silent"], devOnly: true },
    );
  }
  return steps.filter((step) => !(step.devOnly && project.prod));
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
      const line = item.detail ? `${item.name} ${pc.dim(`- ${item.detail}`)}` : item.name;
      if (item.ok) p.log.success(line);
      else if (item.warning) p.log.warn(pc.yellow(line));
      else {
        p.log.error(pc.red(line));
        failed++;
      }
    }
  }
  const running = runningServices(project);
  for (const step of checkSteps(project, Boolean(options.tests))) {
    const service = project.services[step.service];
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

  for (const target of targets) {
    if (compose(target, ["pull", "--ignore-buildable"]) !== 0) fail("Pulling the images failed.");
    const build = ["build", "--pull", ...(options.cache ? [] : ["--no-cache"])];
    if (compose(target, build) !== 0) fail("Building the images failed.");
  }

  const volume = project.prod ? undefined : nodeModulesVolume(project);
  if (volume) {
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

  for (const option of STACK_OPTIONS) {
    const key = option.key as StackKey;
    if (options.fromCli(key)) next[key] = options[key] as string;
    else if (interactive && SWITCHABLE.includes(key)) {
      next[key] = unwrap(
        await p.select<string>({
          message: option.message,
          initialValue: current[key],
          options: (option.values as readonly StackValue[]).map((value) => ({
            value: value.value,
            label: value.label,
            hint: value.generated ? value.hint : "coming soon",
            disabled: !value.generated && value.value !== current[key],
          })),
        }),
      );
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
  writeFileSync(envPath, result.env, { mode: 0o600 });
  const manifestPath = join(project.directory, "package.json");
  if (existsSync(manifestPath))
    writeFileSync(
      manifestPath,
      setManifestPreset(readFileSync(manifestPath, "utf8"), encodePreset(next as Stack)),
    );
  for (const change of result.changes) p.log.success(change);
  p.outro(`Restart to apply it: ${command("dstack stop")}, then ${command("dstack dev")}`);
}

import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { isOnPath, offerGlobalInstall } from "../global-install";
import { chooseFreePorts, describeMove } from "../ports";
import {
  lockBackend,
  relativeDirectory,
  scaffold,
  timeZones,
  toProjectName,
  validateProjectName,
  validateTimeZone,
} from "../scaffold";
import {
  applies,
  DEFAULT_STACK,
  encodePreset,
  PROMPT_ORDER,
  pendingChoices,
  resolvePreset,
  type Stack,
  type StackKey,
  type StackValue,
  stackOption,
} from "../stack";
import { type Check, checkTools } from "../tools";
import { command, fail, has, intro, isInteractive, logCheck, secret, unwrap, url } from "../ui";

export interface InitOptions {
  name?: string;
  /** A preset name or code that sets the stack options. */
  preset?: string;
  databaseUrl?: string;
  /** Deprecated: `--storage s3`. */
  localS3?: boolean;
  demoContent: boolean;
  git: boolean;
  timeZone?: string;
  start?: boolean;
  yes?: boolean;
  link?: string;
  /** The stack options given as flags, by key. */
  [key: string]: unknown;
  /** Whether each option came from the command line, by option name. */
  fromCli: (option: string) => boolean;
}

/**
 * The prompt choices of an option; values this version does not generate yet
 * are shown but disabled. The tasks follow the cache chosen before them: Huey
 * keeps its queue in the database, or in Valkey with the Valkey cache.
 */
export function choices(key: StackKey, stack: Partial<Stack> = {}) {
  const option = stackOption(key);
  return option.values.flatMap((value: StackValue, index) => {
    let hint = value.generated || index === 0 ? value.hint : "coming soon";
    if (key === "tasks" && value.value === "huey") {
      hint =
        stack.cache === "valkey"
          ? "a worker container, the queue in Valkey"
          : "a worker container, the queue in Postgres";
    }
    if (key === "tasks" && value.value === "huey-valkey" && stack.cache === "valkey") return [];
    return [{ value: value.value, label: value.label, hint, disabled: !value.generated && index > 0 }];
  });
}

/**
 * The stack from, in order of precedence, the flags, the preset, the prompts
 * and the defaults. `askDatabase` asks for the Postgres version together with
 * the external database choice; it returns the version, or a URL.
 */
export async function chooseStack(
  options: Pick<InitOptions, "preset" | "fromCli"> & Record<string, unknown>,
  interactive: boolean,
  askDatabase?: (initial: string) => Promise<{ postgres: string } | { databaseUrl: string }>,
): Promise<{ stack: Stack; databaseUrl?: string }> {
  let preset: Stack | undefined;
  if (options.preset) {
    try {
      preset = resolvePreset(options.preset);
    } catch (error) {
      fail((error as Error).message);
    }
  }
  const stack = { ...DEFAULT_STACK } as Record<string, string>;
  let databaseUrl: string | undefined;
  for (const key of PROMPT_ORDER) {
    const option = stackOption(key);
    if (options.fromCli(key)) stack[key] = options[key] as string;
    else if (key === "storage" && options.fromCli("localS3") && options.localS3) stack[key] = "s3";
    else if (preset) stack[key] = preset[key];
    else if (!interactive || !applies(key, stack as Stack)) continue;
    else if (key === "postgres" && askDatabase && !options.databaseUrl) {
      const answer = await askDatabase(stack[key] as string);
      if ("databaseUrl" in answer) databaseUrl = answer.databaseUrl;
      else stack[key] = answer.postgres;
    } else if (key === "postgres" && options.databaseUrl) continue;
    else {
      // With S3 in production, suggest the local S3 service in development: the same code path.
      const initialValue = key === "storage" && stack.media === "s3" ? "s3" : stack[key];
      stack[key] = unwrap(
        await p.select<string>({
          message: option.message,
          options: choices(key, stack as Partial<Stack>),
          initialValue,
        }),
      );
    }
  }
  return { stack: stack as Stack, databaseUrl };
}

function systemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && !validateTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Checks Docker, Node.js and Python before the prompts. Problems only warn:
 * the project is created anyway, and Node.js and Python are for development
 * outside the containers. Returns whether Docker can run the project.
 */
export function checkComputer(checks: Check[] = checkTools()): boolean {
  const passed = checks.filter((check) => check.ok);
  if (passed.length) p.log.success(passed.map((check) => check.detail ?? check.name).join(", "));
  for (const check of checks.filter((check) => !check.ok)) logCheck({ ...check, warning: true });
  return !checks.some((check) => !check.ok && !check.warning);
}

export async function init(directoryArgument: string | undefined, options: InitOptions) {
  const interactive = isInteractive(options.yes);
  intro("Create a project");
  const dockerReady = checkComputer();
  const zoneError = options.timeZone ? validateTimeZone(options.timeZone) : undefined;
  if (zoneError) fail(zoneError);

  let directory = directoryArgument;
  if (!directory) {
    directory = interactive
      ? unwrap(
          await p.text({
            message: "Where should the project go?",
            placeholder: "my-site",
            defaultValue: "my-site",
          }),
        )
      : "my-site";
  }
  const target = resolve(directory);

  let name: string = options.name ?? toProjectName(basename(target));
  if (validateProjectName(name)) {
    if (!interactive) fail(`Pass a valid --name: ${validateProjectName(name)}`);
    name = unwrap(
      await p.text({ message: "Project name", validate: (value) => validateProjectName(value ?? "") }),
    );
  }

  const chosen = await chooseStack(options, interactive, async (initial) => {
    const choice = unwrap(
      await p.select<string>({
        message: "Database",
        initialValue: initial,
        options: [
          ...choices("postgres").map((value) => ({
            ...value,
            label: `Bundled Postgres, ${value.label.toLowerCase()}`,
          })),
          { value: "external", label: "External Postgres", hint: "a URL to your own server" },
        ],
      }),
    );
    if (choice !== "external") return { postgres: choice };
    return {
      databaseUrl: unwrap(
        await p.text({
          message: "Postgres URL",
          placeholder: "postgres://user:password@host:5432/name",
          validate: (value) => (value?.startsWith("postgres") ? undefined : "Enter a postgres:// URL."),
        }),
      ),
    };
  });
  const stack = chosen.stack;
  const databaseUrl = options.databaseUrl ?? chosen.databaseUrl;

  const pending = pendingChoices(stack);
  const unavailable = pending.filter((item) => !item.isDefault);
  if (unavailable.length) {
    fail(
      `${unavailable.map((item) => item.choice).join(", ")} ${unavailable.length > 1 ? "are" : "is"} not available yet. Leave ${unavailable.length > 1 ? "them" : "it"} at the default.`,
    );
  }

  let timeZone = options.timeZone;
  if (!timeZone && interactive) {
    const detected = systemTimeZone();
    timeZone = unwrap(
      await p.autocomplete<string>({
        message: "Time zone",
        placeholder: "Type to filter, such as Amsterdam",
        initialValue: detected,
        maxItems: 8,
        options: timeZones().map((zone) => ({
          value: zone,
          label: zone,
          hint: zone === detected ? "this computer" : undefined,
        })),
      }),
    );
  }

  let demoContent = options.demoContent;
  if (interactive && !options.fromCli("demoContent")) {
    demoContent = unwrap(
      await p.confirm({ message: "Add demo content? (example pages and posts)", initialValue: true }),
    );
  }

  // Free ports for the development services, from the usual ones up.
  const ports = await chooseFreePorts({}, stack.storage === "s3" ? ["s3"] : []);
  for (const move of ports.moves) p.log.info(describeMove(move));

  const spinner = p.spinner();
  spinner.start("Creating the project");
  let result: ReturnType<typeof scaffold>;
  try {
    result = scaffold({
      directory: target,
      name,
      frontend: stack.frontend,
      demoContent,
      databaseUrl,
      localS3: stack.storage === "s3",
      analytics: stack.analytics === "umami",
      cache: stack.cache,
      tasks: stack.tasks,
      preset: encodePreset(stack),
      timeZone,
      ports: ports.ports,
      link: options.link,
    });
  } catch (error) {
    spinner.error("The project was not created.");
    fail((error as Error).message);
  }
  spinner.stop(`Created ${pc.bold(relativeDirectory(target))} ${pc.dim(`(${result.files} files)`)}`);

  if (has("uv")) {
    spinner.start("Locking the backend dependencies");
    if (lockBackend(target)) spinner.stop(`Locked the backend dependencies in ${pc.bold("backend/uv.lock")}`);
    else spinner.error("Could not lock the backend dependencies. The image build resolves them instead.");
  }

  if (options.git && has("git")) {
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: target, stdio: "ignore" });
      execFileSync("git", ["add", "-A"], { cwd: target, stdio: "ignore" });
      execFileSync("git", ["commit", "--quiet", "-m", "Create project with DjangoStack"], {
        cwd: target,
        stdio: "ignore",
      });
      p.log.success("Created a git repository");
    } catch {
      p.log.warn("Could not commit the project with git. Commit it yourself.");
    }
  }

  // Ask before the next steps, so they can name `dstack` once it is installed.
  if (options.installPrompt !== false && !options.yes) await offerGlobalInstall();
  const startCommand = isOnPath() ? "dstack dev" : "docker compose up";

  p.note(
    [
      command(`cd ${relativeDirectory(target)}`),
      command(startCommand),
      "",
      `${pc.bold("Site")}    ${url(`http://localhost:${ports.ports.SITE_PORT}`)}`,
      `${pc.bold("Admin")}   ${url(`http://localhost:${ports.ports.SITE_PORT}/admin/`)}`,
      `${pc.bold("Mail")}    ${url(`http://localhost:${ports.ports.MAIL_PORT}`)}`,
      "",
      `Admin user ${secret(result.adminUsername)}, password ${secret(result.adminPassword)}`,
      pc.dim("The password is in .env as ADMIN_PASSWORD. Change it after you sign in."),
    ].join("\n"),
    "Next steps",
  );

  if (pending.length) {
    p.log.info(
      `Coming in a later version, so not in this project yet: ${pending
        .map((item) => `${stackOption(item.key).message.toLowerCase()} (${stack[item.key]})`)
        .join(", ")}.`,
    );
  }
  if (stack.media === "s3")
    p.log.info(
      `Uploads go to S3 in production. Before the first deploy, ${command("dstack production")} asks for the S3 settings; ${command("dstack settings")} changes them later.`,
    );
  p.log.message(`Create the same stack with ${command(`--preset ${encodePreset(stack)}`)}`);

  if (options.start && !dockerReady) {
    p.outro(
      pc.yellow(
        `Docker is not ready, so the project was not started. Fix the warnings above and run ${command(startCommand)}.`,
      ),
    );
  } else if (options.start) {
    p.outro(`Starting the project with ${command("docker compose up")}`);
    execFileSync("docker", ["compose", "up"], { cwd: target, stdio: "inherit" });
  } else {
    p.outro(pc.green("Done"));
  }
}

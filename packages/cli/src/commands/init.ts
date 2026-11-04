import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  FRONTENDS,
  type Frontend,
  lockBackend,
  relativeDirectory,
  scaffold,
  timeZones,
  toProjectName,
  validateProjectName,
  validateTimeZone,
} from "../scaffold";
import { command, fail, has, intro, isInteractive, secret, unwrap, url } from "../ui";

export interface InitOptions {
  name?: string;
  frontend?: Frontend;
  databaseUrl?: string;
  localS3?: boolean;
  demoContent: boolean;
  git: boolean;
  timeZone?: string;
  start?: boolean;
  yes?: boolean;
  link?: string;
  /** Whether each option came from the command line, by option name. */
  fromCli: (option: string) => boolean;
}

const FRONTEND_LABELS: Record<Frontend, { label: string; hint: string }> = {
  astro: { label: "Astro", hint: "server-rendered, fast by default" },
};

function systemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && !validateTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export async function init(directoryArgument: string | undefined, options: InitOptions) {
  const interactive = isInteractive(options.yes);
  intro("Create a project");
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

  let frontend = options.frontend;
  if (frontend === undefined) {
    frontend = interactive
      ? unwrap(
          await p.autocomplete<Frontend>({
            message: "Frontend",
            placeholder: "Type to filter",
            options: FRONTENDS.map((value) => ({ value, ...FRONTEND_LABELS[value] })),
          }),
        )
      : "astro";
  }

  let databaseUrl = options.databaseUrl;
  if (!databaseUrl && interactive) {
    const bundled = unwrap(
      await p.select({
        message: "Database",
        options: [
          { value: true, label: "Bundled Postgres", hint: "runs in Docker Compose" },
          { value: false, label: "External Postgres", hint: "a URL to your own server" },
        ],
      }),
    );
    if (!bundled) {
      databaseUrl = unwrap(
        await p.text({
          message: "Postgres URL",
          placeholder: "postgres://user:password@host:5432/name",
          validate: (value) => (value?.startsWith("postgres") ? undefined : "Enter a postgres:// URL."),
        }),
      );
    }
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

  let localS3 = Boolean(options.localS3);
  let demoContent = options.demoContent;
  if (interactive) {
    const extras: { value: "demo" | "s3"; label: string; hint: string }[] = [];
    if (!options.fromCli("demoContent"))
      extras.push({ value: "demo", label: "Demo content", hint: "example pages and posts" });
    if (!options.fromCli("localS3"))
      extras.push({
        value: "s3",
        label: "Local S3 for uploads",
        hint: "the same code path as S3 in production",
      });
    if (extras.length) {
      const chosen = unwrap(
        await p.multiselect({
          message: "Extras",
          options: extras,
          initialValues: extras.filter((extra) => extra.value === "demo").map((extra) => extra.value),
          required: false,
        }),
      );
      if (!options.fromCli("demoContent")) demoContent = chosen.includes("demo");
      if (!options.fromCli("localS3")) localS3 = chosen.includes("s3");
    }
  }

  const spinner = p.spinner();
  spinner.start("Creating the project");
  let result: ReturnType<typeof scaffold>;
  try {
    result = scaffold({
      directory: target,
      name,
      frontend,
      demoContent,
      databaseUrl,
      localS3,
      timeZone,
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

  if (!has("docker", ["compose", "version"])) {
    p.log.warn(
      `Docker Compose was not found. Install Docker to run the project: ${url("https://docs.docker.com/get-docker/")}`,
    );
  }

  p.note(
    [
      command(`cd ${relativeDirectory(target)}`),
      command("docker compose up"),
      "",
      `${pc.bold("Site")}    ${url("http://localhost:3000")}`,
      `${pc.bold("Admin")}   ${url("http://localhost:3000/admin/")}`,
      `${pc.bold("Mail")}    ${url("http://localhost:8025")}`,
      "",
      `Admin user ${secret(result.adminUsername)}, password ${secret(result.adminPassword)}`,
      pc.dim("The password is in .env as ADMIN_PASSWORD. Change it after you sign in."),
    ].join("\n"),
    "Next steps",
  );

  if (options.start) {
    p.outro(`Starting the project with ${command("docker compose up")}`);
    execFileSync("docker", ["compose", "up"], { cwd: target, stdio: "inherit" });
  } else {
    p.outro(pc.green("Done"));
  }
}

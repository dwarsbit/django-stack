#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { runDoctor } from "./doctor";
import { productionEnv, validateDomain } from "./production";
import {
  FRONTENDS,
  type Frontend,
  lockBackend,
  relativeDirectory,
  scaffold,
  toProjectName,
  validateProjectName,
} from "./scaffold";
import { generateSecret } from "./secrets";
import { CLI_VERSION } from "./version";

const HELP = `django-stack ${CLI_VERSION}

Usage:
  django-stack init [directory] [options]   Create a project
  django-stack production [directory]       Write .env.production for a server
  django-stack doctor [directory]           Check a project and its services
  django-stack secret [bytes]               Print a random secret
  django-stack --version

Options for init:
  --name <name>            The project name (default: from the directory)
  --frontend <frontend>    ${FRONTENDS.join(", ")} (default: astro)
  --database-url <url>     Use an external Postgres instead of the bundled one
  --local-s3               Store uploads in a local S3 service in development
  --no-demo-content        Start with an empty site
  --no-git                 Don't create a git repository
  --start                  Run \`docker compose up\` when done
  -y, --yes                Accept the defaults without asking

Options for production:
  --domain <domain>        The domain of the site, such as example.com
  --email-url <url>        The SMTP server, such as smtp+tls://user:pass@host:587
  --force                  Overwrite an existing .env.production
  -y, --yes                Don't ask; fail when --domain is missing
`;

function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) fail("Cancelled.");
  return value as Exclude<T, symbol>;
}

function has(command: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function init(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      frontend: { type: "string" },
      "database-url": { type: "string" },
      "local-s3": { type: "boolean" },
      "no-demo-content": { type: "boolean" },
      "no-git": { type: "boolean" },
      start: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      link: { type: "string" },
    },
  });
  const interactive = !values.yes && process.stdin.isTTY;

  p.intro(pc.bold(`DjangoStack ${CLI_VERSION}`));

  let directory: string | undefined = positionals[0];
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

  let name: string = values.name ?? toProjectName(basename(target));
  if (validateProjectName(name)) {
    if (!interactive) fail(`Pass a valid --name: ${validateProjectName(name)}`);
    name = unwrap(
      await p.text({ message: "Project name", validate: (value) => validateProjectName(value ?? "") }),
    );
  }

  let frontend = values.frontend as Frontend | undefined;
  if (frontend && !FRONTENDS.includes(frontend)) {
    fail(`The ${frontend} frontend is not available yet. Choose one of: ${FRONTENDS.join(", ")}.`);
  }
  if (frontend === undefined) {
    frontend = interactive
      ? unwrap(
          await p.select<Frontend>({
            message: "Frontend",
            options: [{ value: "astro", label: "Astro", hint: "server-rendered, fast by default" }],
          }),
        )
      : "astro";
  }

  let databaseUrl: string | undefined = values["database-url"];
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

  let localS3: boolean = Boolean(values["local-s3"]);
  if (interactive && !values["local-s3"]) {
    localS3 = unwrap(
      await p.select({
        message: "Uploads in development",
        options: [
          { value: false, label: "On disk", hint: "simplest" },
          { value: true, label: "Local S3 service", hint: "the same code path as S3 in production" },
        ],
      }),
    );
  }

  let demoContent: boolean = !values["no-demo-content"];
  if (interactive && !values["no-demo-content"]) {
    demoContent = unwrap(await p.confirm({ message: "Add demo pages and posts?", initialValue: true }));
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
      link: values.link,
    });
  } catch (error) {
    spinner.error("The project was not created.");
    fail((error as Error).message);
  }
  spinner.stop(`Created ${relativeDirectory(target)} (${result.files} files)`);

  if (has("uv")) {
    spinner.start("Locking the backend dependencies");
    if (lockBackend(target)) spinner.stop("Locked the backend dependencies in backend/uv.lock");
    else spinner.error("Could not lock the backend dependencies. The image build resolves them instead.");
  }

  if (!values["no-git"] && has("git")) {
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
      "Docker Compose was not found. Install Docker to run the project: https://docs.docker.com/get-docker/",
    );
  }

  p.note(
    [
      `cd ${relativeDirectory(target)}`,
      "docker compose up",
      "",
      `Site    ${pc.cyan("http://localhost:3000")}`,
      `Admin   ${pc.cyan("http://localhost:3000/admin/")}`,
      `Mail    ${pc.cyan("http://localhost:8025")}`,
      "",
      `Admin user ${pc.bold(result.adminUsername)}, password ${pc.bold(result.adminPassword)}`,
      pc.dim("The password is in .env as ADMIN_PASSWORD. Change it after you sign in."),
    ].join("\n"),
    "Next steps",
  );

  if (values.start) {
    p.outro("Starting the project with docker compose up");
    execFileSync("docker", ["compose", "up"], { cwd: target, stdio: "inherit" });
  } else {
    p.outro("Done");
  }
}

async function production(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      domain: { type: "string" },
      "email-url": { type: "string" },
      force: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
    },
  });
  const interactive = !values.yes && process.stdin.isTTY;
  const directory = resolve(positionals[0] ?? ".");
  const envPath = join(directory, ".env");
  const target = join(directory, ".env.production");
  p.intro(pc.bold(`DjangoStack ${CLI_VERSION}: production settings`));
  if (!existsSync(envPath)) fail(`${envPath} does not exist. Run this in a project directory.`);
  if (existsSync(target) && !values.force) fail(`${target} exists. Pass --force to replace it.`);

  let domain = values.domain;
  if (!domain) {
    if (!interactive) fail("Pass --domain, such as --domain example.com.");
    domain = unwrap(
      await p.text({
        message: "Domain of the site",
        placeholder: "example.com",
        validate: (v) => validateDomain(v ?? ""),
      }),
    );
  }
  let result: ReturnType<typeof productionEnv>;
  try {
    result = productionEnv(readFileSync(envPath, "utf8"), { domain, emailUrl: values["email-url"] });
  } catch (error) {
    fail((error as Error).message);
  }
  writeFileSync(target, result.text, { mode: 0o600 });
  p.log.success(`Wrote ${relativeDirectory(target)} with new secrets for the server.`);
  if (result.todo.length)
    p.note(result.todo.map((item) => `- ${item}`).join("\n"), "Before the first deploy");
  p.note(
    [
      `Copy the project to the server, with ${pc.bold(".env.production")} as ${pc.bold(".env")}, then:`,
      "docker compose up -d --build",
      "",
      `Admin  https://${domain}/admin/  user ${pc.bold("admin")}, password ${pc.bold(result.adminPassword)}`,
      pc.dim("Point the domain's DNS at the server first: Caddy needs it for the certificate."),
    ].join("\n"),
    "Deploy",
  );
  p.outro("Done");
}

async function doctor(argv: string[]) {
  const directory = resolve(argv[0] ?? ".");
  p.intro(pc.bold(`DjangoStack doctor ${CLI_VERSION}`));
  const checks = await runDoctor(directory);
  for (const check of checks) {
    const line = check.detail ? `${check.name} ${pc.dim(`- ${check.detail}`)}` : check.name;
    if (check.ok) p.log.success(line);
    else if (check.warning) p.log.warn(line);
    else p.log.error(line);
  }
  const failed = checks.filter((check) => !check.ok && !check.warning).length;
  if (failed) {
    p.outro(pc.red(`${failed} ${failed === 1 ? "check" : "checks"} failed`));
    process.exit(1);
  }
  p.outro(pc.green("All checks passed"));
}

async function main() {
  const [commandName, ...rest] = process.argv.slice(2);
  switch (commandName) {
    case "init":
    case "create":
      return init(rest);
    case "doctor":
      return doctor(rest);
    case "production":
      return production(rest);
    case "secret":
      console.log(generateSecret(Number(rest[0] ?? 32)));
      return;
    case "-v":
    case "--version":
      console.log(CLI_VERSION);
      return;
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${commandName}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

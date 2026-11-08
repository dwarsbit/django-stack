import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseEnv } from "../env";
import { postgresUrl, productionEnv, validateDomain } from "../production";
import { normalizeDatabaseUrl, relativeDirectory } from "../scaffold";
import { remainingTodo, SETTING_NAMES, settingsToAsk } from "../settings";
import { command, fail, intro, isInteractive, secret, unwrap, url } from "../ui";
import { askSettings, projectContext, writeSettings } from "./settings";

export interface ProductionCommandOptions {
  domain?: string;
  emailUrl?: string;
  databaseUrl?: string;
  force?: boolean;
  yes?: boolean;
}

const required = (label: string) => (value: string | undefined) =>
  value?.trim() ? undefined : `Enter the ${label}.`;

/**
 * Asks for the server's database: the bundled Postgres, or your own as a URL
 * or as separate values. Returns the URL of your own, or undefined.
 */
export async function askDatabase(): Promise<string | undefined> {
  const where = unwrap(
    await p.select<string>({
      message: "Database on the server",
      initialValue: "bundled",
      options: [
        { value: "bundled", label: "Bundled Postgres", hint: "a container next to the backend" },
        { value: "external", label: "Your own Postgres", hint: "a managed database or another server" },
      ],
    }),
  );
  if (where === "bundled") return undefined;
  const form = unwrap(
    await p.select<string>({
      message: "How do you want to enter it?",
      initialValue: "parts",
      options: [
        { value: "parts", label: "Host, port, name, user and password", hint: "any password works" },
        { value: "url", label: "A postgres:// URL", hint: "special characters in the password URL-encoded" },
      ],
    }),
  );
  if (form === "url") {
    const value = unwrap(
      await p.text({
        message: "Postgres URL",
        placeholder: "postgres://user:password@db.example.com:5432/app",
        validate: (value) => {
          try {
            normalizeDatabaseUrl((value ?? "").trim());
            return undefined;
          } catch (error) {
            return (error as Error).message;
          }
        },
      }),
    );
    return normalizeDatabaseUrl(value.trim());
  }
  const host = unwrap(
    await p.text({ message: "Host", placeholder: "db.example.com", validate: required("host") }),
  );
  const port = unwrap(
    await p.text({
      message: "Port",
      placeholder: "5432",
      defaultValue: "5432",
      validate: (value) => {
        if (!value) return undefined;
        const port = Number(value);
        return Number.isInteger(port) && port > 0 && port < 65536 ? undefined : "Enter a port, such as 5432.";
      },
    }),
  );
  const name = unwrap(
    await p.text({ message: "Database name", placeholder: "app", validate: required("name") }),
  );
  const user = unwrap(await p.text({ message: "User", placeholder: "app", validate: required("user") }));
  const password = unwrap(await p.password({ message: "Password" }));
  return postgresUrl({
    host: host.trim(),
    port: port.trim(),
    name: name.trim(),
    user: user.trim(),
    password,
  });
}

export async function production(directoryArgument: string | undefined, options: ProductionCommandOptions) {
  const interactive = isInteractive(options.yes);
  const directory = resolve(directoryArgument ?? ".");
  const envPath = join(directory, ".env");
  const target = join(directory, ".env.production");
  intro("Production settings");
  if (!existsSync(envPath)) fail(`${envPath} does not exist. Run this in a project directory.`);
  if (existsSync(target) && !options.force) fail(`${target} exists. Pass --force to replace it.`);

  let domain = options.domain;
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
  const devEnv = readFileSync(envPath, "utf8");
  let databaseUrl = options.databaseUrl;
  if (databaseUrl) {
    try {
      normalizeDatabaseUrl(databaseUrl);
    } catch (error) {
      fail((error as Error).message);
    }
  } else if (interactive && !parseEnv(devEnv).PRODUCTION_DATABASE_URL) {
    databaseUrl = await askDatabase();
  }
  const context = projectContext(directory);
  let result: ReturnType<typeof productionEnv>;
  try {
    result = productionEnv(devEnv, {
      domain,
      emailUrl: options.emailUrl,
      databaseUrl,
      media: context.media,
    });
  } catch (error) {
    fail((error as Error).message);
  }
  writeFileSync(target, result.text, { mode: 0o600 });
  p.log.success(`Wrote ${pc.bold(relativeDirectory(target))} with new secrets for the server.`);

  let todo = result.todo;
  const missing = settingsToAsk(parseEnv(result.text), context);
  if (interactive && missing.length) {
    const now = unwrap(
      await p.confirm({
        message: `Set the ${missing.map((group) => group.title.toLowerCase()).join(", ")} now?`,
        initialValue: true,
      }),
    );
    if (now) {
      try {
        writeSettings(target, await askSettings(missing, parseEnv(result.text)));
      } catch (error) {
        fail((error as Error).message);
      }
      todo = remainingTodo(todo, parseEnv(readFileSync(target, "utf8")));
    }
  }
  if (todo.some((item) => SETTING_NAMES.some((name) => item.includes(name.startsWith("S3_") ? "S3_" : name))))
    todo = [...todo, `Run ${command("dstack settings")} to set them.`];
  if (todo.length)
    p.note(todo.map((item) => `${pc.yellow("•")} ${item}`).join("\n"), "Before the first deploy");
  p.note(
    [
      `Copy the project to the server, with ${pc.bold(".env.production")} as ${pc.bold(".env")}, then:`,
      command("docker compose up -d --build"),
      "",
      `${pc.bold("Admin")}  ${url(`https://${domain}/admin/`)}  user ${secret("admin")}, password ${secret(result.adminPassword)}`,
      pc.dim("Point the domain's DNS at the server first: Caddy needs it for the certificate."),
    ].join("\n"),
    "Deploy",
  );
  p.outro(pc.green("Done"));
}

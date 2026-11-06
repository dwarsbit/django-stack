import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseEnv } from "../env";
import { productionEnv, validateDomain } from "../production";
import { relativeDirectory } from "../scaffold";
import { remainingTodo, SETTING_NAMES, settingsToAsk } from "../settings";
import { command, fail, intro, isInteractive, secret, unwrap, url } from "../ui";
import { askSettings, projectContext, writeSettings } from "./settings";

export interface ProductionCommandOptions {
  domain?: string;
  emailUrl?: string;
  force?: boolean;
  yes?: boolean;
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
  const context = projectContext(directory);
  let result: ReturnType<typeof productionEnv>;
  try {
    result = productionEnv(readFileSync(envPath, "utf8"), {
      domain,
      emailUrl: options.emailUrl,
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

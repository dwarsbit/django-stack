import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseEnv, quoteEnvValue, setEnvValues } from "../env";
import { findProjectDirectory, parseProfiles, projectStack, readProject } from "../project";
import { parseAssignments, type SettingContext, type SettingGroup, settingsToAsk } from "../settings";
import { command, fail, intro, isInteractive, unwrap } from "../ui";

export interface SettingsOptions {
  dir?: string;
  file?: string;
  set?: string[];
  all?: boolean;
  yes?: boolean;
}

/** The `media` stack option of the project, from the preset in package.json. */
export function projectContext(directory: string): SettingContext {
  try {
    return { media: projectStack(readProject(directory)).media };
  } catch {
    return {};
  }
}

/** Asks for each field of the groups; returns the `.env` values. */
export async function askSettings(
  groups: readonly SettingGroup[],
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const group of groups) {
    p.log.step(pc.bold(group.title));
    const answers: Record<string, string> = {};
    for (const field of group.fields) {
      const current = group.current?.(env, field.name);
      const check = (value: string | undefined) => {
        const text = (value ?? "").trim();
        if (!text && (field.optional || field.defaultValue || (field.secret && current))) return undefined;
        return field.validate?.(text) ?? (text ? undefined : `Enter the ${field.message.toLowerCase()}.`);
      };
      let answer: string;
      if (field.secret) {
        answer = unwrap(
          await p.password({
            message: current ? `${field.message} (empty keeps the current one)` : field.message,
            validate: check,
          }),
        );
        if (!answer && current) answer = current;
      } else {
        answer = unwrap(
          await p.text({
            message: field.message,
            placeholder: field.placeholder ?? field.defaultValue,
            initialValue: current,
            defaultValue: field.defaultValue,
            validate: check,
          }),
        );
      }
      answers[field.name] = (answer ?? field.defaultValue ?? "").trim();
    }
    Object.assign(values, group.values(answers));
  }
  return values;
}

/** Writes values to a `.env` file, quoted where Compose needs it. Throws for a value it can't write. */
export function writeSettings(path: string, values: Record<string, string>) {
  const quoted = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, quoteEnvValue(value)]),
  );
  writeFileSync(path, setEnvValues(readFileSync(path, "utf8"), quoted), { mode: 0o600 });
}

/** The production `.env` of a project: `--file`, `.env.production`, or `.env` on a server. */
function targetFile(directory: string, file: string | undefined): string {
  if (file) {
    const path = join(directory, file);
    if (!existsSync(path)) fail(`${path} does not exist.`);
    return path;
  }
  const production = join(directory, ".env.production");
  if (existsSync(production)) return production;
  const env = join(directory, ".env");
  if (existsSync(env) && parseProfiles(parseEnv(readFileSync(env, "utf8")).COMPOSE_PROFILES).includes("prod"))
    return env;
  fail(`There is no .env.production yet. Write it with ${command("dstack production")}.`);
}

/** `dstack settings`: ask for the missing production settings and credentials, and save them. */
export async function settings(options: SettingsOptions) {
  const interactive = isInteractive(options.yes);
  intro("Production settings");
  const directory = findProjectDirectory(options.dir ?? ".");
  if (!directory) fail("No DjangoStack project here: run this where compose.yaml and .env are.");
  const target = targetFile(directory, options.file);
  const name = relative(directory, target);

  let assigned: Record<string, string>;
  try {
    assigned = parseAssignments(options.set ?? []);
  } catch (error) {
    fail((error as Error).message);
  }
  const env = { ...parseEnv(readFileSync(target, "utf8")), ...assigned };
  const context = projectContext(directory);
  const missing = settingsToAsk(env, context);

  let values = assigned;
  if (interactive) {
    const groups = settingsToAsk(env, context, options.all);
    if (!groups.length && !Object.keys(assigned).length) {
      p.outro(pc.green(`Nothing is missing in ${name}`));
      return;
    }
    if (groups.length && !options.all)
      p.log.info(`${name} needs ${groups.map((group) => group.title.toLowerCase()).join(", ")}.`);
    values = { ...assigned, ...(await askSettings(groups, env)) };
  } else if (missing.length) {
    fail(
      `${name} misses ${missing.flatMap((group) => group.missing(env)).join(", ")}. Pass them with --set NAME=value.`,
    );
  } else if (!Object.keys(assigned).length) {
    p.outro(pc.green(`Nothing is missing in ${name}`));
    return;
  }

  try {
    writeSettings(target, values);
  } catch (error) {
    fail((error as Error).message);
  }
  p.log.success(`Saved ${Object.keys(values).join(", ")} in ${pc.bold(name)}`);
  if (existsSync(join(directory, ".dstack", "deploy.json")) && target.endsWith(".env.production"))
    p.outro(`Send them to the platform with ${command("dstack deploy env push")}`);
  else p.outro(pc.green("Done"));
}

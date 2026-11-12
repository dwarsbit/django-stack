import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { findEnvProjectDirectory, freshDevelopmentEnv } from "../dev-env";
import { writePrivateFile } from "../env";
import { relativeDirectory } from "../scaffold";
import { leftoverVolumes } from "../tools";
import { command, fail, intro, isInteractive, secret, unwrap } from "../ui";

export interface EnvCommandOptions {
  dir?: string;
  force?: boolean;
  demoContent?: boolean;
  yes?: boolean;
}

/** `dstack env`: writes a development `.env` with fresh secrets, the way `init` does. */
export async function env(options: EnvCommandOptions, fromCli: (option: string) => boolean = () => false) {
  const interactive = isInteractive(options.yes);
  intro("Development .env");
  const start = options.dir ?? ".";
  const directory = findEnvProjectDirectory(start);
  if (!directory)
    fail(`No DjangoStack project in ${resolve(start)}: run this where compose.yaml and .env.example are.`);
  const target = join(directory, ".env");

  let result: ReturnType<typeof freshDevelopmentEnv>;
  try {
    result = freshDevelopmentEnv(
      directory,
      fromCli("demoContent") ? { demoContent: options.demoContent } : {},
    );
  } catch (error) {
    fail((error as Error).message);
  }

  // Postgres keeps the password it was created with, and the admin user is
  // only created on the first start.
  const volumes = leftoverVolumes(result.name).filter((volume) => !volume.startsWith(`${result.name}-run_`));
  const databaseWarning = `Docker has this project's data (${volumes.join(", ")}), and Postgres keeps the password it was created with: with the new one the backend fails with "password authentication failed for user app".`;

  if (result.replaces && !options.force) {
    if (!interactive) fail(`${relativeDirectory(target)} exists. Pass --force to replace it.`);
    if (volumes.length) p.log.warn(databaseWarning);
    const replace = unwrap(
      await p.confirm({
        message: `Replace ${relativeDirectory(target)}? Its secrets and the values you changed in it are lost.`,
        initialValue: false,
      }),
    );
    if (!replace) fail("Cancelled. .env is unchanged.");
  }

  writePrivateFile(target, result.text);
  p.log.success(`Wrote ${pc.bold(relativeDirectory(target))} with fresh secrets.`);
  if (volumes.length) {
    p.log.warn(
      `${databaseWarning}\nRun ${command("docker compose down --volumes")} to start on an empty database (its data and uploads are deleted for good), or set POSTGRES_PASSWORD and DATABASE_URL in .env to the old password.`,
    );
  }
  p.outro(
    `Admin user ${secret(result.adminUsername)}, password ${secret(result.adminPassword)} on a new database. Start it with ${command("dstack dev")}.`,
  );
}

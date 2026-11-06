import tab from "@bomb.sh/tab/commander";
import * as p from "@clack/prompts";
import { Command, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import {
  deploy,
  deployEnvPush,
  deployLogin,
  deployLogout,
  deployLogs,
  deployRollback,
  deploySetup,
  deployStatus,
} from "./commands/deploy";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { preset } from "./commands/preset";
import { production } from "./commands/production";
import {
  backup,
  check,
  config,
  dev,
  logs,
  manage,
  restore,
  run,
  shell,
  status,
  stop,
  types,
  update as updateProject,
} from "./commands/project";
import { selfUpdate } from "./commands/self-update";
import { settings } from "./commands/settings";
import { DEFAULT_PROVIDER, PROVIDERS } from "./deploy";
import { BIN, offerGlobalInstall } from "./global-install";
import { generateSecret } from "./secrets";
import { NAMED_PRESETS, STACK_OPTIONS } from "./stack";
import { checkForUpdate, updateCheckEnabled, updateCommand } from "./update-check";
import { CLI_VERSION } from "./version";

/** Commands that print machine-readable output or update the CLI, so no update notice. */
const QUIET_COMMANDS = new Set(["secret", "complete", "completion", "self-update"]);

/** A flag for each stack option, such as `--cache <cache>`. */
function stackFlags(): Option[] {
  return STACK_OPTIONS.map((option) => {
    const name = option.flag.slice(2);
    return new Option(
      `${option.flag} <${name}>`,
      `${option.description} (default: ${option.values[0].value})`,
    ).choices(option.values.map((value) => value.value));
  });
}

function positiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("Pass a whole number above 0.");
  return number;
}

export function createProgram(): Command {
  const program = new Command(BIN)
    .description("Create and manage DjangoStack projects.")
    .version(CLI_VERSION, "-v, --version", "Print the version")
    .helpOption("-h, --help", "Show help for a command")
    .helpCommand("help [command]", "Show help for a command")
    .option("--no-update-check", "Don't check npm for a newer version")
    .option("--no-install-prompt", `Don't offer to install ${BIN} globally`)
    .showSuggestionAfterError()
    .configureHelp({
      sortSubcommands: false,
      styleTitle: (text) => pc.bold(text),
      styleCommandText: (text) => pc.green(text),
      styleSubcommandText: (text) => pc.green(text),
      styleOptionText: (text) => pc.cyan(text),
      styleArgumentText: (text) => pc.yellow(text),
      styleDescriptionText: (text) => text,
    })
    .configureOutput({ outputError: (text, write) => write(pc.red(text)) });

  const initCommand = program
    .command("init")
    .alias("create")
    .description("Create a project")
    .argument("[directory]", "Where to create the project")
    .option("--name <name>", "The project name (default: from the directory)")
    .option(
      "--preset <preset>",
      `A preset code from a previous init, or ${Object.keys(NAMED_PRESETS).join(", ")}`,
    )
    .option("--database-url <url>", "Use an external Postgres instead of the bundled one")
    .option("--time-zone <zone>", "The time zone of the backend, such as Europe/Amsterdam (default: UTC)")
    .addOption(new Option("--local-s3", "Same as --storage s3").hideHelp())
    .option("--no-demo-content", "Start with an empty site")
    .option("--no-git", "Don't create a git repository")
    .option("--start", "Run `docker compose up` when done")
    .option("-y, --yes", "Accept the defaults without asking")
    .addOption(new Option("--link <repository>", "Take the packages from a DjangoStack checkout").hideHelp())
    .action((directory: string | undefined, options, cmd: Command) =>
      init(directory, {
        ...options,
        installPrompt: program.opts().installPrompt,
        fromCli: (option) => cmd.getOptionValueSource(option) === "cli",
      }),
    );
  for (const flag of stackFlags()) initCommand.addOption(flag);

  const dirOption = () =>
    new Option("-C, --dir <directory>", "The project directory (default: this one or a parent)");

  program
    .command("run")
    .description("Run the production setup in the background (locally at https://site.localhost)")
    .addOption(dirOption())
    .option("--no-build", "Don't build the images first")
    .action(run);

  program
    .command("dev")
    .description("Run the development servers with hot reload")
    .addOption(dirOption())
    .option("--no-build", "Don't build the images first")
    .action(dev);

  program.command("stop").description("Stop the project; the data stays").addOption(dirOption()).action(stop);

  program
    .command("logs")
    .description("Show the logs of the services")
    .argument("[services...]", "Only these services, such as backend")
    .addOption(dirOption())
    .option("--no-follow", "Print the logs and exit")
    .option("-n, --tail <lines>", "Only the last lines of each service")
    .action(logs);

  program
    .command("status")
    .description("Show the containers and whether the database, cache, worker and backups are healthy")
    .addOption(dirOption())
    .action(status);

  program
    .command("check")
    .description("Check the project: setup, Django checks, migrations and linters")
    .addOption(dirOption())
    .option("--tests", "Run the backend and frontend tests too")
    .action(check);

  program
    .command("update")
    .description("Pull and rebuild the images and update the DjangoStack packages")
    .addOption(dirOption())
    .option("--all", "Update every backend package in uv.lock, not only django-stack")
    .option("--no-cache", "Rebuild the images from scratch")
    .option("--no-restart", "Don't restart what was running")
    .action(updateProject);

  const configCommand = program
    .command("config")
    .description("Change the stack options of a project")
    .addOption(dirOption())
    .option("-y, --yes", "Don't ask; change only what the flags set")
    .action((options, cmd: Command) =>
      config({ ...options, fromCli: (option) => cmd.getOptionValueSource(option) === "cli" }),
    );
  for (const flag of stackFlags()) configCommand.addOption(flag);

  program
    .command("manage")
    .description("Run a Django management command in the backend")
    .argument("<args...>", "The command and its options, such as createsuperuser")
    .addOption(dirOption())
    .allowUnknownOption()
    .helpOption(false)
    .action((args: string[], options) => manage(args, options));

  program
    .command("shell")
    .description("Open Django's shell in the backend")
    .addOption(dirOption())
    .action(shell);

  program
    .command("backup")
    .description("Back up the database and the media now (prod profile)")
    .addOption(dirOption())
    .option("--list", "List the backups instead")
    .option("--no-media", "Back up only the database")
    .action(backup);

  program
    .command("restore")
    .description("Restore a backup over the database or the media (prod profile)")
    .argument("<backup>", "A file name from `dstack backup --list`")
    .addOption(dirOption())
    .option("--media", "Also restore the media backed up with this database dump")
    .option("-y, --yes", "Don't ask for confirmation")
    .action(restore);

  program
    .command("types")
    .description("Generate the frontend's API types from the backend's schema")
    .addOption(dirOption())
    .action(types);

  const providerOption = () =>
    new Option("--provider <provider>", `The platform (default: ${DEFAULT_PROVIDER.id})`).choices(
      PROVIDERS.map((provider) => provider.id),
    );

  const deployCommand = program
    .command("deploy")
    .description("Deploy to Coolify, Dokploy, Bunny, Railway or a server over SSH, and show the status");

  deployCommand
    .command("start", { isDefault: true })
    .description("Start a deploy and follow it; the same as `dstack deploy`")
    .addOption(dirOption())
    .option("--force", "Rebuild the images without cache")
    .option("--no-wait", "Don't follow the deploy; return once it started")
    .option("--no-push-check", "Deploy even when it would not include your local commits or changes")
    .option("-y, --yes", "Don't ask; fail when no API key is saved")
    .action(deploy);

  const setupCommand = deployCommand
    .command("setup")
    .description("Create the project on the platform and link it to this directory")
    .addOption(dirOption())
    .addOption(providerOption())
    .option(
      "--url <url>",
      "The platform's address, such as https://coolify.example.com, or the server, such as deploy@example.com",
    )
    .option("--repository <url>", "The git repository the platform builds (default: the origin remote)")
    .option("--branch <branch>", "The branch to deploy (default: the current one)")
    .option("--deploy", "Deploy when done")
    .option("--no-deploy", "Don't offer to deploy when done")
    .option("--force", `Set up again, replacing the link in .dstack/deploy.json`)
    .option("-y, --yes", "Don't ask; use the flags and the defaults")
    .action(deploySetup);
  const seen = new Set<string>();
  for (const flag of PROVIDERS.flatMap((provider) => provider.setupFlags)) {
    if (seen.has(flag.name)) continue;
    seen.add(flag.name);
    const kebab = flag.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    setupCommand.option(`--${kebab} <value>`, flag.description);
  }

  deployCommand
    .command("status")
    .description("Show the state of the site and the last deploys")
    .addOption(dirOption())
    .option("-n, --limit <count>", "How many deploys to list", "5")
    .option("--watch", "Follow a running deploy until it ends")
    .action(deployStatus);

  deployCommand
    .command("logs")
    .description("Print the build log of a deploy")
    .argument("[deployment]", "A deploy id from `dstack deploy status` (default: the latest)")
    .addOption(dirOption())
    .action(deployLogs);

  deployCommand
    .command("rollback")
    .description("Run an earlier release again (servers over SSH)")
    .argument(
      "[deployment]",
      "A deploy id from `dstack deploy status` (default: the one before the running one)",
    )
    .addOption(dirOption())
    .option("--no-wait", "Don't follow the rollback; return once it started")
    .option("-y, --yes", "Don't ask")
    .action(deployRollback);

  deployCommand
    .command("env")
    .description("Manage the platform's environment variables")
    .command("push")
    .description("Replace the platform's variables with .env.production")
    .addOption(dirOption())
    .option("-y, --yes", "Don't ask for confirmation")
    .action(deployEnvPush);

  deployCommand
    .command("login")
    .description("Check and save an API key in the system keychain")
    .addOption(dirOption())
    .addOption(providerOption())
    .option("--url <url>", "The platform's address (default: the one in .dstack/deploy.json)")
    .option(
      "--token <token>",
      "The API key (default: ask, or the provider's environment variable with --yes)",
    )
    .option("-y, --yes", "Don't ask")
    .action(deployLogin);

  deployCommand
    .command("logout")
    .description("Remove a saved API key")
    .addOption(dirOption())
    .addOption(providerOption())
    .option("--url <url>", "The platform's address (default: the one in .dstack/deploy.json)")
    .action(deployLogout);

  const presetCommand = program
    .command("preset")
    .description("Print the preset code of a stack, or the stack of a code")
    .argument("[preset]", "A preset code or name to show")
    .option("-y, --yes", "Don't ask; use the flags and the defaults")
    .action((code: string | undefined, options, cmd: Command) =>
      preset(code, { ...options, fromCli: (option) => cmd.getOptionValueSource(option) === "cli" }),
    );
  for (const flag of stackFlags()) presetCommand.addOption(flag);

  program
    .command("production")
    .description("Write .env.production for a server")
    .argument("[directory]", "The project directory", ".")
    .option("--domain <domain>", "The domain of the site, such as example.com")
    .option("--email-url <url>", "The SMTP server, such as smtp+tls://user:pass@host:587")
    .option("--force", "Overwrite an existing .env.production")
    .option("-y, --yes", "Don't ask; fail when --domain is missing")
    .action(production);

  program
    .command("settings")
    .description("Ask for the missing production settings and credentials, and save them")
    .addOption(dirOption())
    .option("--file <file>", "The file to change (default: .env.production, or .env on a server)")
    .option(
      "--set <NAME=value>",
      "Set a value without asking, such as --set ADMIN_EMAIL=you@example.com",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option("--all", "Ask for every setting, also the ones that are set")
    .option("-y, --yes", "Don't ask; fail when a setting is still missing")
    .action(settings);

  program
    .command("doctor")
    .description("Check a project and its services")
    .argument("[directory]", "The project directory", ".")
    .action(doctor);

  program.command("self-update").description(`Update ${BIN} to the latest version on npm`).action(selfUpdate);

  program
    .command("secret")
    .description("Print a random secret")
    .argument("[bytes]", "The number of random bytes", positiveInteger, 32)
    .action((bytes: number) => console.log(generateSecret(bytes)));

  tab(program, { completionCommandName: "completion" });
  const completion = program.commands.find((cmd) => cmd.name() === "completion");
  completion
    ?.description("Print a shell completion script (zsh, bash, fish or powershell)")
    .addHelpText(
      "after",
      `\nAdd it to your shell, for example in ~/.zshrc:\n  ${pc.cyan("source <(dstack completion zsh)")}`,
    );

  let update: Promise<string | undefined> | undefined;
  let offerInstall = false;
  program.hook("preAction", (_root, action) => {
    if (QUIET_COMMANDS.has(action.name())) return;
    offerInstall = program.opts().installPrompt !== false && !action.opts().yes;
    if (program.opts().updateCheck === false || !updateCheckEnabled()) return;
    update = checkForUpdate({ current: CLI_VERSION });
  });
  program.hook("postAction", async () => {
    // A fresh global install is the latest version, so no update notice after it.
    if (offerInstall && (await offerGlobalInstall())) return;
    // The check started with the command; it times out on its own.
    const latest = await update;
    if (!latest) return;
    p.box(
      [
        `${pc.dim(CLI_VERSION)} ${pc.dim("→")} ${pc.green(pc.bold(latest))}`,
        `Run ${pc.cyan(updateCommand())}`,
      ].join("\n"),
      pc.yellow("Update available"),
      {
        formatBorder: (text) => pc.yellow(text),
        contentAlign: "center",
        titleAlign: "center",
        width: "auto",
        rounded: true,
        withGuide: false,
      },
    );
  });

  return program;
}

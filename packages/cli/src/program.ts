import tab from "@bomb.sh/tab/commander";
import * as p from "@clack/prompts";
import { Command, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { production } from "./commands/production";
import { FRONTENDS } from "./scaffold";
import { generateSecret } from "./secrets";
import { checkForUpdate, updateCheckEnabled, updateCommand } from "./update-check";
import { CLI_VERSION } from "./version";

/** Commands that print machine-readable output, so no update notice. */
const QUIET_COMMANDS = new Set(["secret", "complete", "completion"]);

function positiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InvalidArgumentError("Pass a whole number above 0.");
  return number;
}

export function createProgram(): Command {
  const program = new Command("django-stack")
    .description("Create and manage DjangoStack projects.")
    .version(CLI_VERSION, "-v, --version", "Print the version")
    .helpOption("-h, --help", "Show help for a command")
    .helpCommand("help [command]", "Show help for a command")
    .option("--no-update-check", "Don't check npm for a newer version")
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

  program
    .command("init")
    .alias("create")
    .description("Create a project")
    .argument("[directory]", "Where to create the project")
    .option("--name <name>", "The project name (default: from the directory)")
    .addOption(
      new Option("--frontend <frontend>", "The frontend framework (default: astro)").choices(FRONTENDS),
    )
    .option("--database-url <url>", "Use an external Postgres instead of the bundled one")
    .option("--time-zone <zone>", "The time zone of the backend, such as Europe/Amsterdam (default: UTC)")
    .option("--local-s3", "Store uploads in a local S3 service in development")
    .option("--no-demo-content", "Start with an empty site")
    .option("--no-git", "Don't create a git repository")
    .option("--start", "Run `docker compose up` when done")
    .option("-y, --yes", "Accept the defaults without asking")
    .addOption(new Option("--link <repository>", "Take the packages from a DjangoStack checkout").hideHelp())
    .action((directory: string | undefined, options, cmd: Command) =>
      init(directory, {
        ...options,
        fromCli: (option) => cmd.getOptionValueSource(option) === "cli",
      }),
    );

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
    .command("doctor")
    .description("Check a project and its services")
    .argument("[directory]", "The project directory", ".")
    .action(doctor);

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
      `\nAdd it to your shell, for example in ~/.zshrc:\n  ${pc.cyan("source <(django-stack completion zsh)")}`,
    );

  let update: Promise<string | undefined> | undefined;
  program.hook("preAction", (_root, action) => {
    if (QUIET_COMMANDS.has(action.name()) || program.opts().updateCheck === false) return;
    if (!updateCheckEnabled()) return;
    update = checkForUpdate({ current: CLI_VERSION });
  });
  program.hook("postAction", async () => {
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

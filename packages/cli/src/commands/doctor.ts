import { resolve } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { runDoctor } from "../doctor";
import { intro } from "../ui";

export async function doctor(directoryArgument: string | undefined) {
  const directory = resolve(directoryArgument ?? ".");
  intro("Doctor");
  const spinner = p.spinner();
  spinner.start("Checking the project and its services");
  const checks = await runDoctor(directory);
  spinner.clear();
  for (const check of checks) {
    const line = check.detail ? `${check.name} ${pc.dim(`- ${check.detail}`)}` : check.name;
    if (check.ok) p.log.success(line);
    else if (check.warning) p.log.warn(pc.yellow(line));
    else p.log.error(pc.red(line));
  }
  const failed = checks.filter((check) => !check.ok && !check.warning).length;
  if (failed) {
    p.outro(pc.red(`${failed} ${failed === 1 ? "check" : "checks"} failed`));
    process.exitCode = 1;
    return;
  }
  p.outro(pc.green("All checks passed"));
}

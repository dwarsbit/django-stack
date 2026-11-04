import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { CLI_VERSION } from "./version";

/** The DjangoStack badge with the version and an optional title. */
export function intro(title?: string) {
  const badge = pc.bgGreen(pc.black(pc.bold(" DjangoStack ")));
  p.intro(`${badge} ${pc.dim(`v${CLI_VERSION}`)}${title ? ` ${pc.bold(title)}` : ""}`);
}

export function fail(message: string): never {
  p.cancel(pc.red(message));
  process.exit(1);
}

export function unwrap<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) fail("Cancelled.");
  return value as Exclude<T, symbol>;
}

export function has(command: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const url = (value: string) => pc.cyan(pc.underline(value));
export const command = (value: string) => pc.cyan(value);
export const secret = (value: string) => pc.bold(pc.yellow(value));

/** Prompts only when stdin is a terminal and `--yes` was not passed. */
export function isInteractive(yes: boolean | undefined): boolean {
  return !yes && Boolean(process.stdin.isTTY);
}

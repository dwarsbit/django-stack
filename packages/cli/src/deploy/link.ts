import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DeployLink } from "./provider";

/** Where a project deploys, relative to the project directory. It holds no secrets and can be committed. */
export const LINK_FILE = ".dstack/deploy.json";

export function readLink(directory: string): DeployLink | undefined {
  const path = join(directory, LINK_FILE);
  if (!existsSync(path)) return undefined;
  let link: Partial<DeployLink>;
  try {
    link = JSON.parse(readFileSync(path, "utf8")) as Partial<DeployLink>;
  } catch {
    throw new Error(`${LINK_FILE} is not valid JSON.`);
  }
  for (const key of ["provider", "url", "project", "environment", "application"] as const) {
    if (typeof link[key] !== "string" || !link[key]) throw new Error(`${LINK_FILE} has no ${key}.`);
  }
  return link as DeployLink;
}

export function writeLink(directory: string, link: DeployLink) {
  const path = join(directory, LINK_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const { provider, url, project, environment, application } = link;
  writeFileSync(path, `${JSON.stringify({ provider, url, project, environment, application }, null, 2)}\n`);
}

/** An https URL for a git remote: git@github.com:owner/repo.git becomes https://github.com/owner/repo. */
export function httpsRepository(remote: string): string {
  const value = remote.trim();
  const scp = value.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  let url: string;
  if (scp) {
    url = `https://${scp[1]}/${scp[2]}`;
  } else {
    try {
      const parsed = new URL(value);
      url = `https://${parsed.host.replace(/:\d+$/, "")}${parsed.pathname}`;
    } catch {
      throw new Error(`Cannot read the git remote ${value}.`);
    }
  }
  return url.replace(/\.git$/, "").replace(/\/$/, "");
}

function git(directory: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function gitRemote(directory: string, remote = "origin"): string | undefined {
  return git(directory, ["remote", "get-url", remote]) || undefined;
}

export function gitBranch(directory: string): string | undefined {
  const branch = git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : undefined;
}

/**
 * Why a deploy of `branch` would not include the local commit, or undefined
 * when origin has it. The platform builds from the remote, not from here.
 */
export function unpushedReason(directory: string, branch: string): string | undefined {
  const head = git(directory, ["rev-parse", "HEAD"]);
  if (!head) return undefined; // Not a git repository: nothing to compare.
  if (git(directory, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]) === undefined)
    return `origin has no branch ${branch}. Push it first: git push -u origin ${branch}`;
  if (git(directory, ["merge-base", "--is-ancestor", head, `refs/remotes/origin/${branch}`]) === undefined)
    return `Your last commit is not on origin/${branch}, so the deploy would not include it. Push first: git push`;
  return undefined;
}

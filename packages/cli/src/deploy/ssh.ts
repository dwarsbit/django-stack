import { execFileSync, spawn } from "node:child_process";
import type {
  AppState,
  AppStatus,
  DeployLink,
  Deployment,
  DeploymentStatus,
  DeployProvider,
  ProviderClient,
  ProviderTarget,
  SetupContext,
} from "./provider";

/**
 * A Linux server with Docker, over SSH. The CLI uses the system `ssh`, so
 * ~/.ssh/config, the agent and known_hosts work as in the terminal, and
 * stores no keys. A deploy uploads the local commit (`git archive HEAD`)
 * into a new release directory and runs `docker compose up` there,
 * detached, so a dropped connection does not stop it:
 *
 *   <path>/shared/.env              .env.production, owned by the server after setup
 *   <path>/releases/<id>/           one per deploy, .env linked to shared/.env
 *   <path>/current -> releases/<id> the release that runs
 *   <path>/deploys/<id>.{json,status,log}
 *
 * A fixed Compose project name keeps the volumes (database, media,
 * certificates) across releases. Caddy gets the certificate itself, as in
 * the server guide, so there are no platform variables.
 */

/** Releases kept on the server for rollbacks, the running one included. */
export const KEEP_RELEASES = 5;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `ssh` with the arguments; `input` goes to its stdin. */
export type SshRunner = (args: string[], input?: Buffer | string) => Promise<RunResult>;

export const systemSsh: SshRunner = (args, input) =>
  new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === "ENOENT"
            ? "There is no ssh command here. Install OpenSSH."
            : `Could not run ssh: ${error.message}`,
        ),
      ),
    );
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    child.stdin.on("error", () => {}); // ssh may exit before reading all input; its exit code says why.
    child.stdin.end(input);
  });

export interface SshTarget {
  user?: string;
  host: string;
  port?: number;
}

const USER = /^[a-z_][\w.-]*$/i;
const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/i;

/** Reads deploy@example.com, example.com:2222 or ssh://deploy@example.com:2222. */
export function parseTarget(value: string): SshTarget {
  const trimmed = value
    .trim()
    .replace(/^ssh:\/\//i, "")
    .replace(/\/$/, "");
  const match = trimmed.match(/^(?:([^@\s]+)@)?(\[[^\]]+\]|[^:@\s]+)(?::(\d+))?$/);
  const reason = `${value} is not an SSH target. Enter one such as deploy@example.com or deploy@example.com:2222.`;
  if (!match) throw new Error(reason);
  const [, user, host = "", port] = match;
  if ((user && !USER.test(user)) || !HOST.test(host)) throw new Error(reason);
  const number = port ? Number(port) : undefined;
  if (number !== undefined && (number < 1 || number > 65535)) throw new Error(reason);
  return { user, host, port: number };
}

export function formatTarget(target: SshTarget): string {
  return `ssh://${target.user ? `${target.user}@` : ""}${target.host}${target.port ? `:${target.port}` : ""}`;
}

/** Quotes a value for the remote POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A Compose project name: lower case letters, digits, dashes and underscores. */
export function composeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|-+$/g, "");
  return cleaned || "site";
}

/** A deploy id that sorts by time: 20261105-183000-abc1234. */
export function deployId(date: Date, suffix: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${day}-${time}-${suffix}`;
}

const ID = /^[\w.-]+$/;

/** What the server records about a deploy, next to its status and log. */
export interface DeployRecord {
  id: string;
  /** The release directory it runs, under releases/. */
  release: string;
  commit?: string;
  message?: string;
  createdAt: string;
  /** The deploy this one rolls back to. */
  rollbackOf?: string;
}

/** The status file: building, finished or failed, and whether the deploy's process lives. */
export function recordStatus(status: string, alive: boolean): DeploymentStatus {
  const value = status.trim();
  if (value === "finished") return "finished";
  if (value === "failed") return "failed";
  if (value === "queued") return alive ? "queued" : "failed";
  if (value === "building") return alive ? "building" : "failed";
  return "failed";
}

interface ComposeContainer {
  Service?: string;
  State?: string;
  Health?: string;
}

/** `docker compose ps --format json` prints an array (older) or one object per line (newer). */
export function parseComposePs(output: string): ComposeContainer[] {
  const text = output.trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text) as ComposeContainer[];
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ComposeContainer);
}

export function composeState(containers: ComposeContainer[]): { state: AppState; detail: string } {
  if (!containers.length) return { state: "stopped", detail: "no containers" };
  const running = containers.filter((item) => item.State === "running");
  const unhealthy = containers.filter((item) => item.Health === "unhealthy" || item.State === "restarting");
  const summary = `${running.length}/${containers.length} running`;
  if (!running.length) return { state: "stopped", detail: summary };
  if (unhealthy.length)
    return {
      state: "degraded",
      detail: `${summary}, unhealthy: ${unhealthy.map((item) => item.Service).join(", ")}`,
    };
  if (running.length < containers.length) {
    const stopped = containers.filter((item) => item.State !== "running");
    return {
      state: "degraded",
      detail: `${summary}, not running: ${stopped.map((item) => item.Service).join(", ")}`,
    };
  }
  return { state: "running", detail: summary };
}

/** Splits the output of a remote command whose parts are separated by MARK lines. */
const MARK = "--dstack-8f2c--";

function parts(output: string): string[] {
  return output.split(`\n${MARK}\n`);
}

/**
 * The script that runs a deploy on the server, detached. It builds and
 * starts the release, moves `current` to it on success and removes the
 * oldest releases beyond KEEP_RELEASES.
 */
export function deployScript(
  path: string,
  project: string,
  id: string,
  release: string,
  force: boolean,
): string {
  const q = shellQuote;
  const compose = `docker compose -p ${q(project)}`;
  return `#!/bin/sh
set -u
app=${q(path)}
status="$app/deploys/${id}.status"
trap 'rm -rf "$app/deploy.lock"' EXIT
cd "$app/releases/${release}" || { echo failed > "$status"; exit 1; }
echo building > "$status"
echo "Deploy ${id}: release ${release}"
${force ? `${compose} build --no-cache --pull && ` : ""}${compose} up -d --build --remove-orphans --wait --wait-timeout 600
code=$?
if [ "$code" -ne 0 ]; then
  echo "docker compose exited with $code"
  ${compose} ps --all
  echo failed > "$status"
  exit "$code"
fi
ln -sfn "releases/${release}" "$app/current"
cd "$app/releases"
ls -1 | sort -r | tail -n +${KEEP_RELEASES + 1} | while read -r old; do
  [ "$old" = ${q(release)} ] || rm -rf -- "$old"
done
echo "Started release ${release}"
echo finished > "$status"
`;
}

export class SshClient implements ProviderClient {
  readonly target: SshTarget;

  constructor(
    target: string,
    private readonly run: SshRunner = systemSsh,
    private readonly git: (args: string[]) => Buffer = defaultGit,
  ) {
    this.target = parseTarget(target);
  }

  private get destination(): string {
    return `${this.target.user ? `${this.target.user}@` : ""}${this.target.host.replace(/^\[|\]$/g, "")}`;
  }

  /** Runs a POSIX shell script on the server; fails with a one-line reason. */
  async sh(script: string, input?: Buffer | string): Promise<string> {
    const args = [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      ...(this.target.port ? ["-p", String(this.target.port)] : []),
      "--",
      this.destination,
      `sh -c ${shellQuote(script)}`,
    ];
    const result = await this.run(args, input);
    if (result.code === 0) return result.stdout;
    throw new Error(this.errorMessage(result));
  }

  private errorMessage(result: RunResult): string {
    const stderr = result.stderr.trim();
    const where = formatTarget(this.target);
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr))
      return `The host key of ${where} changed. If you reinstalled the server, remove the old key with ssh-keygen -R ${this.target.host}; otherwise do not connect.`;
    if (/Host key verification failed|No .* host key is known/i.test(stderr))
      return `${where} is not in your known_hosts yet. Connect once with ssh ${this.destination}${this.target.port ? ` -p ${this.target.port}` : ""}, check the fingerprint and answer yes, then try again.`;
    if (/Permission denied/i.test(stderr))
      return `${where} refused your SSH key. Add it with ssh-copy-id ${this.destination}, or load it into the agent with ssh-add.`;
    if (result.code === 255)
      return `Could not connect to ${where}: ${stderr.split("\n").at(-1) || "ssh failed"}`;
    const last = (stderr || result.stdout.trim()).split("\n").at(-1) ?? "";
    return `The command on ${where} failed (exit ${result.code})${last ? `: ${last}` : "."}`;
  }

  /** Checks the connection and Docker; returns their versions. */
  async verify(): Promise<string> {
    const output = await this.sh(`
command -v docker >/dev/null 2>&1 || { echo missing:docker; exit 0; }
docker compose version --short 2>/dev/null || echo missing:compose
docker info --format '{{.ServerVersion}}' 2>/dev/null || echo missing:permission
`);
    if (output.includes("missing:docker"))
      throw new Error(
        `${formatTarget(this.target)} has no Docker. Install Docker Engine with the Compose plugin: https://docs.docker.com/engine/install/`,
      );
    if (output.includes("missing:compose"))
      throw new Error(
        `${formatTarget(this.target)} has Docker without the Compose plugin. Install docker-compose-plugin: https://docs.docker.com/compose/install/linux/`,
      );
    if (output.includes("missing:permission"))
      throw new Error(
        `${this.destination} may not use Docker on the server. Run sudo usermod -aG docker ${this.target.user ?? "$USER"} there and connect again.`,
      );
    const [compose = "", engine = ""] = output.trim().split("\n");
    return `Docker ${engine.trim()}, Compose ${compose.trim().replace(/^v/, "")}`;
  }

  async setup(context: SetupContext) {
    const { ask, options } = context;
    let path = options.path ?? `/srv/${composeName(context.name)}`;
    if (path.startsWith("~/")) path = `${(await this.sh('printf %s "$HOME"')).trim()}/${path.slice(2)}`;
    if (!path.startsWith("/"))
      throw new Error(`Give --path as an absolute path, such as /srv/${composeName(context.name)}.`);
    path = path.replace(/\/+$/, "");
    const q = shellQuote;
    const made = await this.sh(`
if mkdir -p ${q(`${path}/releases`)} ${q(`${path}/shared`)} ${q(`${path}/deploys`)} 2>/dev/null && [ -w ${q(path)} ]; then echo ok; fi
`);
    if (!made.includes("ok")) {
      const home = (await this.sh('printf %s "$HOME"')).trim();
      throw new Error(
        `${this.destination} cannot write to ${path} on the server. Create it there with sudo mkdir -p ${path} && sudo chown ${this.target.user ?? "$USER"} ${path}, or pass a directory you own, such as --path ${home}/${composeName(context.name)}.`,
      );
    }
    ask.step(`Created ${path} on the server`);
    const project = composeName(context.name);
    const link = { project: path, environment: "production", application: project };
    await this.pushEnv({ provider: "ssh", url: formatTarget(this.target), ...link }, context.env);
    ask.step("Uploaded the variables as shared/.env");
    return link;
  }

  async pushEnv(link: DeployLink, env: Record<string, string>): Promise<void> {
    const text = Object.entries(env)
      .map(([key, value]) => `${key}=${envValue(value)}`)
      .join("\n");
    const file = shellQuote(`${link.project}/shared/.env`);
    await this.sh(
      `umask 077 && cat > ${file}.new && chmod 600 ${file}.new && mv ${file}.new ${file}`,
      `${text}\n`,
    );
  }

  async deploy(link: DeployLink, options: { force: boolean; directory: string }): Promise<string> {
    const { directory } = options;
    const [commit = "", message = ""] = this.git(["-C", directory, "log", "-1", "--format=%h%n%s"])
      .toString("utf8")
      .split("\n");
    const id = deployId(new Date(), commit || "local");
    await this.lock(link, id);
    const archive = this.git(["-C", directory, "archive", "--format=tar", "HEAD"]);
    const release = shellQuote(`${link.project}/releases/${id}`);
    await this.sh(
      `mkdir -p ${release} && tar -x -C ${release} && ln -sfn ../../shared/.env ${release}/.env`,
      archive,
    );
    await this.start(
      link,
      { id, release: id, commit, message, createdAt: new Date().toISOString() },
      options.force,
    );
    return id;
  }

  async rollback(link: DeployLink, to?: string): Promise<string> {
    const deployments = await this.records(link, 50);
    const current = (await this.sh(`readlink ${shellQuote(`${link.project}/current`)} || true`))
      .trim()
      .replace(/^releases\//, "");
    const releases = new Set(
      (await this.sh(`ls -1 ${shellQuote(`${link.project}/releases`)}`)).split("\n").filter(Boolean),
    );
    let target: DeployRecord | undefined;
    if (to) {
      target = deployments.find((item) => item.record.id === to)?.record;
      if (!target) throw new Error(`There is no deploy ${to} on the server.`);
    } else {
      target = deployments.find(
        (item) =>
          item.status === "finished" && item.record.release !== current && releases.has(item.record.release),
      )?.record;
      if (!target) throw new Error("There is no earlier release on the server to roll back to.");
    }
    if (!releases.has(target.release))
      throw new Error(
        `The release of ${target.id} is no longer on the server; only the last ${KEEP_RELEASES} are kept.`,
      );
    const id = deployId(new Date(), "rollback");
    await this.lock(link, id);
    await this.start(
      link,
      {
        id,
        release: target.release,
        commit: target.commit,
        message: `Rollback to ${target.id}`,
        createdAt: new Date().toISOString(),
        rollbackOf: target.id,
      },
      false,
    );
    return id;
  }

  /** Takes the server's deploy lock, or fails when a deploy is running. */
  private async lock(link: DeployLink, id: string) {
    const lock = shellQuote(`${link.project}/deploy.lock`);
    const output = await this.sh(`
if mkdir ${lock} 2>/dev/null; then echo ${id} > ${lock}/id; echo ok; exit 0; fi
pid=$(cat ${lock}/pid 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "busy:$(cat ${lock}/id 2>/dev/null)"; exit 0; fi
rm -rf ${lock} && mkdir ${lock} && echo ${id} > ${lock}/id && echo ok
`);
    const busy = output.match(/busy:(\S*)/);
    if (busy)
      throw new Error(
        `Deploy ${busy[1]} is still running on the server. Follow it with dstack deploy status --watch.`,
      );
    if (!output.includes("ok")) throw new Error("Could not take the deploy lock on the server.");
  }

  private async start(link: DeployLink, record: DeployRecord, force: boolean) {
    if (!ID.test(record.id) || !ID.test(record.release)) throw new Error(`Invalid deploy id ${record.id}.`);
    const deploys = `${link.project}/deploys`;
    const q = shellQuote;
    const script = deployScript(link.project, link.application, record.id, record.release, force);
    await this.sh(
      `
cd ${q(deploys)} || exit 1
cat > ${q(`${record.id}.sh`)}
printf '%s\\n' ${q(JSON.stringify(record))} > ${q(`${record.id}.json`)}
echo queued > ${q(`${record.id}.status`)}
nohup sh ${q(`${record.id}.sh`)} > ${q(`${record.id}.log`)} 2>&1 < /dev/null &
echo $! > ${q(`${record.id}.pid`)}
echo $! > ${q(`${link.project}/deploy.lock/pid`)}
`,
      script,
    );
  }

  /** The newest deploy records first, with their status. */
  private async records(
    link: DeployLink,
    limit: number,
  ): Promise<{ record: DeployRecord; status: DeploymentStatus; updatedAt?: string }[]> {
    const output = await this.sh(`
cd ${shellQuote(`${link.project}/deploys`)} 2>/dev/null || exit 0
for file in $(ls -1 *.json 2>/dev/null | sort -r | head -n ${Math.max(1, Math.floor(limit))}); do
  id="\${file%.json}"
  cat "$file"
  pid=$(cat "$id.pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=1; else alive=0; fi
  printf '%s %s %s\\n' "$(cat "$id.status" 2>/dev/null || echo failed)" "$alive" "$(date -u -r "$id.status" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
  echo ${MARK}
done
`);
    const items: { record: DeployRecord; status: DeploymentStatus; updatedAt?: string }[] = [];
    for (const part of parts(`\n${output}`)) {
      const lines = part.trim().split("\n");
      if (lines.length < 2) continue;
      try {
        const record = JSON.parse(lines[0] ?? "") as DeployRecord;
        const [status = "", alive = "0", updatedAt] = (lines[1] ?? "").split(" ");
        items.push({
          record,
          status: recordStatus(status, alive === "1"),
          updatedAt: updatedAt || undefined,
        });
      } catch {
        // A record that is not JSON was not written by dstack; skip it.
      }
    }
    return items;
  }

  async deployment(link: DeployLink, id: string): Promise<Deployment> {
    if (!ID.test(id)) throw new Error(`Invalid deploy id ${id}.`);
    const deploys = shellQuote(`${link.project}/deploys`);
    const output = await this.sh(`
cd ${deploys} || exit 1
[ -f ${shellQuote(`${id}.json`)} ] || { echo missing; exit 0; }
cat ${shellQuote(`${id}.json`)}
pid=$(cat ${shellQuote(`${id}.pid`)} 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then alive=1; else alive=0; fi
printf '%s %s %s\\n' "$(cat ${shellQuote(`${id}.status`)} 2>/dev/null || echo failed)" "$alive" "$(date -u -r ${shellQuote(`${id}.status`)} +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)"
echo ${MARK}
cat ${shellQuote(`${id}.log`)} 2>/dev/null
`);
    if (output.trim() === "missing") throw new Error(`There is no deploy ${id} on the server.`);
    const [head = "", log = ""] = output.split(`\n${MARK}\n`);
    const [json = "{}", state = ""] = head.split("\n");
    const record = JSON.parse(json) as DeployRecord;
    const [status = "", alive = "0", updatedAt] = state.split(" ");
    return {
      ...toDeployment(record, recordStatus(status, alive === "1"), updatedAt || undefined),
      log: log
        ? log
            .replace(/\n$/, "")
            .split("\n")
            .map((text) => ({ text, stderr: false }))
        : [],
    };
  }

  async deployments(link: DeployLink, limit: number): Promise<Deployment[]> {
    return (await this.records(link, limit)).map((item) => ({
      ...toDeployment(item.record, item.status, item.updatedAt),
      log: [],
    }));
  }

  async status(link: DeployLink): Promise<AppStatus> {
    const output = await this.sh(`
docker compose -p ${shellQuote(link.application)} ps --all --format json
echo ${MARK}
sed -n 's/^SITE_URL=//p' ${shellQuote(`${link.project}/shared/.env`)} 2>/dev/null
`);
    const [ps = "", site = ""] = parts(output);
    const { state, detail } = composeState(parseComposePs(ps));
    const domain = site.trim().replace(/^["']|["']$/g, "");
    return { state, detail, domains: domain ? [domain] : [] };
  }
}

function toDeployment(
  record: DeployRecord,
  status: DeploymentStatus,
  updatedAt?: string,
): Omit<Deployment, "log"> {
  return {
    id: record.id,
    status,
    commit: record.commit,
    message: record.message,
    createdAt: record.createdAt,
    updatedAt,
  };
}

/**
 * A value for a Compose .env line: bare when safe, else single-quoted (taken
 * literally), or double-quoted with escapes when it holds a single quote.
 */
export function envValue(value: string): string {
  if (/^[\w@%+=:,./-]*$/.test(value)) return value;
  if (!value.includes("'") && !value.includes("\n")) return `'${value}'`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "$$$$").replace(/\n/g, "\\n")}"`;
}

function defaultGit(args: string[]): Buffer {
  return execFileSync("git", args, { maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export const sshTarget: ProviderTarget = {
  label: "Server",
  placeholder: "deploy@example.com",
  normalize: (value) => formatTarget(parseTarget(value)),
};

export const ssh: DeployProvider = {
  id: "ssh",
  name: "SSH server",
  auth: { kind: "ssh" },
  source: "local",
  target: sshTarget,
  platformEnv: {},
  setupFlags: [
    { name: "path", description: "The project directory on the server (default: /srv/<project>)" },
  ],
  connect: (target) => new SshClient(target),
};

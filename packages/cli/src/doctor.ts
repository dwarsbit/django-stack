import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "./env";

export interface Check {
  name: string;
  ok: boolean;
  /** Not a failure: the check could not run or only warns. */
  warning?: boolean;
  detail?: string;
}

const REQUIRED_KEYS = [
  "DJANGO_SECRET_KEY",
  "DATABASE_URL",
  "API_SECRET_KEY",
  "API_READ_KEY",
  "PREVIEW_SECRET",
  "REVALIDATE_SECRET",
  "SITE_URL",
];

function command(cmd: string, args: string[], cwd?: string): string | undefined {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

async function fetchStatus(url: string, headers: Record<string, string> = {}): Promise<number | undefined> {
  try {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
    return response.status;
  } catch {
    return undefined;
  }
}

/** Checks a project directory: tools, .env, and the running services. */
export async function runDoctor(directory: string): Promise<Check[]> {
  const checks: Check[] = [];

  const docker = command("docker", ["version", "--format", "{{.Server.Version}}"]);
  checks.push({
    name: "Docker is running",
    ok: Boolean(docker),
    detail: docker ? `Docker ${docker}` : "Install Docker and start it: https://docs.docker.com/get-docker/",
  });
  const compose = command("docker", ["compose", "version", "--short"]);
  checks.push({
    name: "Docker Compose v2",
    ok: Boolean(compose),
    detail: compose
      ? `Compose ${compose}`
      : "Docker Compose v2 is part of Docker Desktop and the docker-compose-plugin package.",
  });

  const envPath = join(directory, ".env");
  if (!existsSync(envPath)) {
    checks.push({
      name: ".env exists",
      ok: false,
      detail: "Run the doctor in the project directory, or copy .env.example to .env.",
    });
    return checks;
  }
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  checks.push({
    name: ".env has the required values",
    ok: missing.length === 0,
    detail: missing.length ? `Missing: ${missing.join(", ")}` : undefined,
  });
  checks.push({
    name: "The API keys differ",
    ok: Boolean(env.API_SECRET_KEY) && env.API_SECRET_KEY !== env.API_READ_KEY,
    detail: "API_SECRET_KEY has full access and API_READ_KEY only reads; they must not be the same.",
  });
  const debug = ["1", "true", "yes", "on"].includes((env.DJANGO_DEBUG ?? "").toLowerCase());
  if (debug && env.SITE_URL?.startsWith("https://")) {
    checks.push({
      name: "Debug is off for an https site",
      ok: false,
      detail: "Set DJANGO_DEBUG=0 in production.",
    });
  }

  const profiles = (env.COMPOSE_PROFILES ?? "").split(",").map((profile) => profile.trim());
  const prod = profiles.includes("prod");
  if (prod) {
    checks.push({
      name: "SITE_URL is https",
      ok: (env.SITE_URL ?? "").startsWith("https://"),
      detail: "In production SITE_URL is https://your-domain; Caddy gets the certificate for it.",
    });
    checks.push({
      name: "Mail goes to an SMTP server",
      ok:
        Boolean(env.EMAIL_URL) &&
        !env.EMAIL_URL?.includes("mailpit") &&
        !env.EMAIL_URL?.includes("example.com"),
      detail: "Set EMAIL_URL to your SMTP server; Mailpit only runs in development.",
    });
  }

  const running = command("docker", ["compose", "ps", "--services", "--filter", "status=running"], directory);
  const services = running ? running.split("\n").filter(Boolean) : [];
  const backendService = prod ? "backend-prod" : "backend";
  const frontendService = prod ? "frontend-prod" : "frontend";
  checks.push({
    name: "Services are running",
    ok: services.includes(backendService) && services.includes(frontendService),
    warning: services.length === 0,
    detail: services.length
      ? services.join(", ")
      : `Nothing is running. Start the project with \`docker compose up${prod ? " -d" : ""}\`.`,
  });
  if (services.length === 0) return checks;

  const health = command("docker", ["compose", "ps", backendService, "--format", "{{.Health}}"], directory);
  checks.push({
    name: "The backend is healthy",
    ok: health === "healthy",
    detail: health
      ? `The ${backendService} container is ${health}`
      : `See \`docker compose logs ${backendService}\`.`,
  });
  const site = (env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const frontend = await fetchStatus(site);
  checks.push({
    name: "The site answers",
    ok: frontend !== undefined && frontend < 500,
    detail: frontend
      ? `${site} answered ${frontend}`
      : `No answer on ${site}. See \`docker compose logs ${prod ? "proxy" : frontendService}\`.`,
  });
  const api = await fetchStatus(`${site}/api/content.sitesettings`, {
    "X-Secret-Key": env.API_READ_KEY ?? "",
  });
  checks.push({
    name: "The read-only key reads the API",
    ok: api === 200,
    detail: api ? `${site}/api answered ${api}` : "No answer from the API.",
  });
  const closed = await fetchStatus(`${site}/api/content.sitesettings`);
  checks.push({
    name: "The API is closed without a key",
    ok: closed === 401 || closed === 403,
    detail: closed ? `The API answered ${closed} without a key` : undefined,
  });
  return checks;
}

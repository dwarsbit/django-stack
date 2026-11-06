import { createConnection, createServer } from "node:net";

/** A port the development services publish on this machine, from `.env`. */
export interface DevPort {
  /** The `.env` variable, such as SITE_PORT. */
  name: string;
  /** The port when the variable is not set. */
  port: number;
  label: string;
  /** Only published with this Compose profile. */
  profile?: string;
}

export const DEV_PORTS: readonly DevPort[] = [
  { name: "SITE_PORT", port: 3000, label: "site" },
  { name: "BACKEND_PORT", port: 8000, label: "backend" },
  { name: "MAIL_PORT", port: 8025, label: "Mailpit" },
  { name: "S3_PORT", port: 8333, label: "local S3 service", profile: "s3" },
];

/** How many ports above the usual one to try. */
const TRIES = 100;

export type PortCheck = (port: number) => Promise<boolean>;

/** Whether something answers on 127.0.0.1:port. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Whether this process can listen on 127.0.0.1:port. */
function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/**
 * Whether a port is free for Docker to publish on 127.0.0.1. Both checks,
 * because on macOS a server on all addresses does not stop a listen on
 * 127.0.0.1, but it does answer there.
 */
export const isPortFree: PortCheck = async (port) => !(await answers(port)) && (await canListen(port));

/** The first free port from `preferred` up, leaving out `taken`. */
export async function freePort(
  preferred: number,
  taken: ReadonlySet<number> = new Set(),
  isFree: PortCheck = isPortFree,
): Promise<number | undefined> {
  for (let port = preferred; port < preferred + TRIES && port <= 65535; port++) {
    if (!taken.has(port) && (await isFree(port))) return port;
  }
  return undefined;
}

/** The ports of a `.env`, by variable. */
export function envPorts(env: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    DEV_PORTS.map((item) => {
      const value = Number(env[item.name]);
      return [item.name, Number.isInteger(value) && value > 0 ? value : item.port];
    }),
  );
}

/**
 * The `.env` values for new ports: the ports, and the URLs on this machine
 * that contain them (SITE_URL and BACKEND_URL, and S3_PUBLIC_URL of the
 * local S3 service).
 */
export function portValues(
  env: Record<string, string>,
  ports: Record<string, number>,
): Record<string, string> {
  const before = envPorts(env);
  const values: Record<string, string> = {};
  for (const item of DEV_PORTS) {
    const port = ports[item.name];
    if (port !== undefined && port !== before[item.name]) values[item.name] = String(port);
  }
  const replacePort = (url: string | undefined, from: number | undefined, to: number | undefined) => {
    if (!url || from === undefined || to === undefined || from === to) return undefined;
    const local = new RegExp(`^(https?://(?:localhost|127\\.0\\.0\\.1)):${from}(?=/|$)`);
    return local.test(url) ? url.replace(local, `$1:${to}`) : undefined;
  };
  for (const [name, port] of [
    ["SITE_URL", "SITE_PORT"],
    ["BACKEND_URL", "SITE_PORT"],
    ["S3_PUBLIC_URL", "S3_PORT"],
  ] as const) {
    const url = replacePort(env[name], before[port], ports[port]);
    if (url) values[name] = url;
  }
  return values;
}

export interface PortMove {
  label: string;
  from: number;
  to: number;
}

/**
 * Free ports for the development services of a `.env`: the ones it has
 * when they are free, otherwise the next free ones up. Returns the moves,
 * or the ports that have no free one nearby.
 */
export async function chooseFreePorts(
  env: Record<string, string>,
  profiles: readonly string[],
  isFree: PortCheck = isPortFree,
): Promise<{ ports: Record<string, number>; moves: PortMove[]; stuck: DevPort[] }> {
  const ports = envPorts(env);
  const moves: PortMove[] = [];
  const stuck: DevPort[] = [];
  const taken = new Set<number>();
  for (const item of DEV_PORTS) {
    const current = ports[item.name] as number;
    if (item.profile && !profiles.includes(item.profile)) {
      taken.add(current);
      continue;
    }
    const port =
      !taken.has(current) && (await isFree(current)) ? current : await freePort(current + 1, taken, isFree);
    if (port === undefined) {
      stuck.push(item);
      taken.add(current);
      continue;
    }
    if (port !== current) moves.push({ label: item.label, from: current, to: port });
    ports[item.name] = port;
    taken.add(port);
  }
  return { ports, moves, stuck };
}

/** A line for a port that moved, such as `Port 3000 is in use, so the site uses 3001.` */
export function describeMove(move: PortMove): string {
  return `Port ${move.from} is in use, so the ${move.label} uses ${move.to}.`;
}

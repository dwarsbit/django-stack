/**
 * Server errors of the frontend to Sentry (sentry.io), with `ERRORS=sentry`.
 *
 * A small client of Sentry's envelope endpoint, without the Sentry SDK and
 * its dependencies. `reportError()` sends one event with the error, its
 * causes and their stack traces, tagged with the request ID that Caddy
 * sets. It sends nothing in the browser, outside production, or without
 * `SENTRY_DSN`, and it never throws. No personal data is sent: no
 * headers, cookies, query strings or request bodies.
 */

import { version } from "../package.json";

export interface ErrorContext {
  /** The request being handled: its method, path and `X-Request-ID` are sent. */
  request?: Request;
  method?: string;
  /** The path of the request; a query string is left out. */
  path?: string;
  requestId?: string | null;
  tags?: Record<string, string>;
}

export interface SentryOptions {
  dsn: string;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
}

export interface SentryFrame {
  function?: string;
  filename: string;
  abs_path: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

interface Dsn {
  url: string;
  key: string;
}

/** The envelope URL and public key of a DSN, or null when it is not one. */
export function parseDsn(dsn: string): Dsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const project = parts.pop();
  if (!url.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return { url: `${url.protocol}//${url.host}${prefix}/api/${project}/envelope/`, key: url.username };
}

const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** The frames of a V8 stack trace, oldest call first, as Sentry expects them. */
export function parseStack(stack: string | undefined): SentryFrame[] {
  const frames: SentryFrame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const [, name, file = "", lineno, colno] = match;
    const path = file.replace(/^file:\/\//, "");
    frames.push({
      function: name?.replace(/^async /, "") || undefined,
      filename: path,
      abs_path: path,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !path.includes("/node_modules/") && !path.startsWith("node:"),
    });
  }
  return frames.reverse();
}

function describe(value: unknown): string {
  if (typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value);
  }
}

function exceptions(error: unknown) {
  const values = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    const err = current instanceof Error ? current : null;
    const frames = err ? parseStack(err.stack) : [];
    values.push({
      type: err ? err.name : "Error",
      value: err ? err.message : describe(current),
      ...(frames.length ? { stacktrace: { frames } } : {}),
      mechanism: { type: "generic", handled: false },
    });
    current = err?.cause;
  }
  // Sentry lists the cause first, the error that was thrown last.
  return values.reverse();
}

/** The Sentry event of an error. */
export function errorEvent(error: unknown, context: ErrorContext = {}, options: Partial<SentryOptions> = {}) {
  const request = context.request;
  const method = context.method ?? request?.method;
  let path = context.path ?? (request ? new URL(request.url).pathname : undefined);
  path = path?.split("?")[0];
  const requestId = context.requestId ?? request?.headers.get("x-request-id") ?? undefined;
  return {
    event_id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    server_name: "frontend",
    environment: options.environment || "production",
    ...(options.release ? { release: options.release } : {}),
    exception: { values: exceptions(error) },
    tags: { ...context.tags, ...(requestId ? { request_id: requestId } : {}) },
    ...(path ? { transaction: path, request: { method, url: path } } : {}),
    contexts: { runtime: { name: "node", version: globalThis.process?.version } },
    sdk: { name: "django-stack.utils", version },
  };
}

let pausedUntil = 0;
// The errors sent in the last minute: a request whose error page fails the
// same way, as it does when the API is down, sends one event, not three.
const recent = new Map<string, number>();
const REPEAT_WINDOW = 60_000;

function repeated(event: ReturnType<typeof errorEvent>): boolean {
  const now = Date.now();
  for (const [key, time] of recent) if (now - time > REPEAT_WINDOW) recent.delete(key);
  const values = event.exception.values.map((value) => `${value.type}: ${value.value}`);
  const key = JSON.stringify([event.tags.request_id ?? event.event_id, values]);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

/** Sends an error to Sentry. Resolves to whether Sentry took it; never throws. */
export async function sendToSentry(
  error: unknown,
  context: ErrorContext,
  options: SentryOptions,
): Promise<boolean> {
  const dsn = parseDsn(options.dsn);
  if (!dsn || Date.now() < pausedUntil) return false;
  try {
    const event = errorEvent(error, context, options);
    if (repeated(event)) return false;
    const body = [
      JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    const response = await (options.fetch ?? fetch)(dsn.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=django-stack.utils/${version}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    // Over the quota or the rate limit: wait as long as Sentry asks.
    if (response.status === 429) {
      pausedUntil = Date.now() + (Number(response.headers.get("retry-after")) || 60) * 1000;
    }
    return response.ok;
  } catch {
    return false;
  }
}

/** The Sentry options of the environment, or null when errors do not go to Sentry. */
export function sentryOptions(env: Record<string, string | undefined> | undefined = globalThis.process?.env) {
  if (!env || typeof window !== "undefined") return null;
  if (env.NODE_ENV !== "production" || env.ERRORS !== "sentry" || !env.SENTRY_DSN) return null;
  return { dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT, release: env.SENTRY_RELEASE };
}

/**
 * Reports a server error to Sentry with `ERRORS=sentry` and `SENTRY_DSN`,
 * in production. Does nothing otherwise.
 */
export async function reportError(error: unknown, context: ErrorContext = {}): Promise<void> {
  const options = sentryOptions();
  if (options) await sendToSentry(error, context, options);
}

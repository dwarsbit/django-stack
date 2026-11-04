import { type AnyModels, type ClientOptions, DjangoRestClient, type ModelMap } from "@django-headless/client";

export interface StackClientOptions {
  /** The URL the API is included at, such as http://backend:8000/api. Default: `API_URL`. */
  apiUrl?: string;
  /** The read-only API key. Default: `API_READ_KEY`. */
  apiKey?: string;
  /** A preview token: the API then returns drafts as well. */
  previewToken?: string | null;
  /** The header of the preview token. Default `X-Preview-Token`. */
  previewHeader?: string;
  /** Other options for `fetch` of every request. */
  init?: RequestInit;
  fetch?: typeof fetch;
  /** Environment variables to read the defaults from. Default: `process.env`. */
  env?: Record<string, string | undefined>;
}

function processEnv(): Record<string, string | undefined> {
  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return globalProcess?.env ?? {};
}

/**
 * A Django Headless client for server-side code, configured from the
 * environment: `API_URL` and the read-only key `API_READ_KEY`.
 *
 * Refuses to run in a browser with a key, so the key never ends up in
 * client-side code.
 */
export function createClient<Ms extends ModelMap = AnyModels>(
  options: StackClientOptions = {},
): DjangoRestClient<Ms> {
  const env = options.env ?? processEnv();
  const apiUrl = options.apiUrl ?? env.API_URL;
  const apiKey = options.apiKey ?? env.API_READ_KEY;

  if (!apiUrl) {
    throw new Error("Set API_URL to the URL of the Django API, such as http://backend:8000/api.");
  }
  if (apiKey && typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error(
      "createClient() with an API key runs on the server only; the key must not reach the browser.",
    );
  }

  const headers: Record<string, string> = {};
  if (options.previewToken) {
    headers[options.previewHeader ?? "X-Preview-Token"] = options.previewToken;
  }

  return new DjangoRestClient<Ms>({
    baseUrl: apiUrl.replace(/\/$/, ""),
    ...(apiKey ? { secretKey: apiKey } : {}),
    headers,
    ...(options.init ? { init: options.init as ClientOptions["init"] } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

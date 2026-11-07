import { describe, expect, it, vi } from "vitest";
import { errorEvent, parseDsn, parseStack, sendToSentry, sentryOptions } from "../src";

const DSN = "https://abc123@o42.ingest.sentry.io/4507";

describe("parseDsn", () => {
  it("gives the envelope URL and the key", () => {
    expect(parseDsn(DSN)).toEqual({ url: "https://o42.ingest.sentry.io/api/4507/envelope/", key: "abc123" });
    expect(parseDsn("https://key@sentry.example.com/prefix/7")?.url).toBe(
      "https://sentry.example.com/prefix/api/7/envelope/",
    );
  });

  it("refuses what is not a DSN", () => {
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("https://o42.ingest.sentry.io/4507")).toBeNull();
    expect(parseDsn("https://key@o42.ingest.sentry.io/")).toBeNull();
  });
});

describe("parseStack", () => {
  it("lists the frames oldest first", () => {
    const frames = parseStack(
      [
        "Error: boom",
        "    at render (file:///app/dist/server/pages/index.mjs:12:9)",
        "    at async handle (/app/node_modules/astro/dist/core/app.js:300:5)",
        "    at node:internal/process/task_queues:105:5",
      ].join("\n"),
    );
    expect(frames.map((frame) => [frame.function, frame.filename, frame.lineno, frame.in_app])).toEqual([
      [undefined, "node:internal/process/task_queues", 105, false],
      ["handle", "/app/node_modules/astro/dist/core/app.js", 300, false],
      ["render", "/app/dist/server/pages/index.mjs", 12, true],
    ]);
  });
});

describe("errorEvent", () => {
  it("has the error, its cause and the request without personal data", () => {
    const cause = new TypeError("fetch failed");
    const error = new Error("Could not load the page", { cause });
    const request = new Request("https://site.example/blog/?token=secret", {
      headers: { "X-Request-ID": "rid-1", Cookie: "session=1" },
    });
    const event = errorEvent(error, { request }, { environment: "staging", release: "1.2.3" });
    expect(event.exception.values.map((value) => [value.type, value.value])).toEqual([
      ["TypeError", "fetch failed"],
      ["Error", "Could not load the page"],
    ]);
    expect(event.tags).toEqual({ request_id: "rid-1" });
    expect(event.request).toEqual({ method: "GET", url: "/blog/" });
    expect(event).toMatchObject({ environment: "staging", release: "1.2.3", level: "error" });
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("session");
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("takes values that are not errors", () => {
    const event = errorEvent("nope", { path: "/x?y=1" });
    expect(event.exception.values).toEqual([
      { type: "Error", value: "nope", mechanism: { type: "generic", handled: false } },
    ]);
    expect(event.request?.url).toBe("/x");
  });
});

describe("sendToSentry", () => {
  it("posts an envelope with the key", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    expect(await sendToSentry(new Error("boom"), { requestId: "rid" }, { dsn: DSN, fetch })).toBe(true);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect(new Headers(init.headers).get("X-Sentry-Auth")).toContain("sentry_key=abc123");
    const [header, item, event] = String(init.body)
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(item).toEqual({ type: "event" });
    expect(event.event_id).toBe(header.event_id);
    expect(event.tags.request_id).toBe("rid");
  });

  it("sends the same error of one request once", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const options = { dsn: DSN, fetch };
    expect(await sendToSentry(new Error("once"), { requestId: "rid-2" }, options)).toBe(true);
    expect(await sendToSentry(new Error("once"), { requestId: "rid-2" }, options)).toBe(false);
    expect(await sendToSentry(new Error("once"), { requestId: "rid-3" }, options)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("describes a cause that is not an error", () => {
    const error = new Error("Server Error", { cause: { statusCode: 502 } });
    expect(errorEvent(error).exception.values[0]?.value).toBe('{"statusCode":502}');
  });

  it("never throws, and waits after a rate limit", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendToSentry(new Error("boom"), {}, { dsn: DSN, fetch: failing })).toBe(false);

    const limited = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "30" } }));
    expect(await sendToSentry(new Error("boom"), {}, { dsn: DSN, fetch: limited })).toBe(false);
    expect(await sendToSentry(new Error("boom"), {}, { dsn: DSN, fetch: limited })).toBe(false);
    expect(limited).toHaveBeenCalledTimes(1);
  });
});

describe("sentryOptions", () => {
  const env = { NODE_ENV: "production", ERRORS: "sentry", SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "staging" };

  it("reads the environment", () => {
    expect(sentryOptions(env)).toEqual({ dsn: DSN, environment: "staging", release: undefined });
  });

  it("is off in development, without the DSN or with other error reports", () => {
    expect(sentryOptions({ ...env, NODE_ENV: "development" })).toBeNull();
    expect(sentryOptions({ ...env, SENTRY_DSN: "" })).toBeNull();
    expect(sentryOptions({ ...env, ERRORS: "email" })).toBeNull();
  });
});

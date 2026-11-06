import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  fetchLatestVersion,
  isNewer,
  updateCheckEnabled,
  updateCommand,
} from "../src/update-check";

const root = mkdtempSync(join(tmpdir(), "django-stack-update-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const cachePath = () => join(root, `cache-${n++}`, "update-check.json");

function registry(version: string, ok = true) {
  return vi.fn(async () => new Response(JSON.stringify({ version }), { status: ok ? 200 : 500 }));
}

describe("isNewer", () => {
  it("compares versions", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.10.0")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isNewer("2.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewer("nonsense", "1.0.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("returns the newer version and caches it", async () => {
    const path = cachePath();
    const fetch = registry("0.3.0");
    expect(await checkForUpdate({ current: "0.2.0", cachePath: path, fetch })).toBe("0.3.0");
    expect(JSON.parse(readFileSync(path, "utf8")).latest).toBe("0.3.0");
    // The second run uses the cache.
    expect(await checkForUpdate({ current: "0.2.0", cachePath: path, fetch })).toBe("0.3.0");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when up to date", async () => {
    expect(await checkForUpdate({ current: "0.3.0", cachePath: cachePath(), fetch: registry("0.3.0") })).toBe(
      undefined,
    );
  });

  it("asks the registry again after a day", async () => {
    const path = cachePath();
    const fetch = registry("0.4.0");
    await checkForUpdate({ current: "0.3.0", cachePath: path, fetch, now: () => 0 });
    await checkForUpdate({ current: "0.3.0", cachePath: path, fetch, now: () => 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await checkForUpdate({ current: "0.3.0", cachePath: path, fetch, now: () => 25 * 60 * 60 * 1000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never throws", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await checkForUpdate({ current: "0.1.0", cachePath: cachePath(), fetch: failing })).toBe(
      undefined,
    );
    expect(
      await checkForUpdate({ current: "0.1.0", cachePath: cachePath(), fetch: registry("9.0.0", false) }),
    ).toBe(undefined);
    // A cache that can't be written still gives the result.
    writeFileSync(join(root, "not-a-dir"), "");
    expect(
      await checkForUpdate({
        current: "0.1.0",
        cachePath: join(root, "not-a-dir", "x.json"),
        fetch: registry("0.2.0"),
      }),
    ).toBe("0.2.0");
  });
});

describe("updateCheckEnabled", () => {
  it("is off in CI, without a terminal and when turned off", () => {
    expect(updateCheckEnabled({}, true)).toBe(true);
    expect(updateCheckEnabled({}, false)).toBe(false);
    expect(updateCheckEnabled({ CI: "true" }, true)).toBe(false);
    expect(updateCheckEnabled({ CI: "0" }, true)).toBe(true);
    expect(updateCheckEnabled({ DJANGO_STACK_NO_UPDATE_CHECK: "1" }, true)).toBe(false);
    expect(updateCheckEnabled({ NO_UPDATE_NOTIFIER: "1" }, true)).toBe(false);
  });
});

describe("updateCommand", () => {
  it("matches how the CLI was started", () => {
    expect(
      updateCommand("file:///home/me/.npm/_npx/abc/node_modules/@django-stack/cli/dist/bin.js", {}),
    ).toBe("npx @django-stack/cli@latest");
    expect(
      updateCommand("file:///home/me/.cache/pnpm/dlx/abc/node_modules/@django-stack/cli/dist/bin.js", {}),
    ).toBe("pnpm dlx @django-stack/cli@latest");
    expect(
      updateCommand("file:///tmp/bunx-1000-@django-stack/cli@latest/node_modules/@django-stack/cli/x.js", {}),
    ).toBe("bunx @django-stack/cli@latest");
    expect(updateCommand("file:///home/me/.local/share/pnpm/global/5/node_modules/x.js", {})).toBe(
      "dstack self-update",
    );
    expect(updateCommand("file:///usr/local/lib/node_modules/@django-stack/cli/dist/bin.js", {})).toBe(
      "dstack self-update",
    );
    expect(updateCommand("file:///home/me/django-stack/packages/cli/dist/bin.js", {})).toBe("git pull");
  });
});

describe("fetchLatestVersion", () => {
  it("returns the version and throws when the registry fails", async () => {
    const answer = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchLatestVersion({ fetch: answer(200, { version: "1.2.3" }) })).toBe("1.2.3");
    await expect(fetchLatestVersion({ fetch: answer(503, {}) })).rejects.toThrow(/503/);
    await expect(fetchLatestVersion({ fetch: answer(200, {}) })).rejects.toThrow(/no version/);
  });
});

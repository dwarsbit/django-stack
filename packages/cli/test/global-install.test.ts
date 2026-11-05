import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  explainFailure,
  installCommand,
  isOnPath,
  readInstallAnswer,
  saveInstallAnswer,
  selfCommand,
  shouldOffer,
  temporaryRunner,
} from "../src/global-install";

const root = mkdtempSync(join(tmpdir(), "django-stack-install-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const NPX = "file:///home/me/.npm/_npx/abc/node_modules/@django-stack/cli/dist/bin.js";
const DLX = "file:///home/me/.cache/pnpm/dlx/abc/node_modules/@django-stack/cli/dist/bin.js";
const BUNX = "file:///tmp/bunx-1000-@django-stack/cli@latest/node_modules/@django-stack/cli/dist/bin.js";
const GLOBAL = "file:///usr/local/lib/node_modules/@django-stack/cli/dist/bin.js";

function binDir(name: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dstack"), "");
  chmodSync(join(dir, "dstack"), 0o755);
  return dir;
}

describe("temporaryRunner", () => {
  it("tells npx, pnpm dlx and bunx from an installed copy", () => {
    expect(temporaryRunner(NPX)).toBe("npm");
    expect(temporaryRunner(DLX)).toBe("pnpm");
    expect(temporaryRunner(BUNX)).toBe("bun");
    expect(temporaryRunner(GLOBAL)).toBe(undefined);
  });
});

describe("isOnPath", () => {
  it("finds dstack, but not in the directories npx adds", () => {
    const global = binDir("global/bin");
    const npx = binDir(".npm/_npx/abc/node_modules/.bin");
    expect(isOnPath({ PATH: global }, "linux")).toBe(true);
    expect(isOnPath({ PATH: npx }, "linux")).toBe(false);
    expect(isOnPath({ PATH: join(root, "nothing") }, "linux")).toBe(false);
    expect(isOnPath({}, "linux")).toBe(false);
  });
});

describe("selfCommand", () => {
  it("is dstack when installed, otherwise the runner", () => {
    const empty = { PATH: join(root, "nothing") };
    expect(selfCommand(GLOBAL, empty)).toBe("dstack");
    expect(selfCommand(NPX, empty)).toBe("npx @django-stack/cli");
    expect(selfCommand(DLX, empty)).toBe("pnpm dlx @django-stack/cli");
    expect(selfCommand(BUNX, empty)).toBe("bunx @django-stack/cli");
    expect(selfCommand(NPX, { PATH: binDir("installed/bin") })).toBe("dstack");
  });
});

describe("installCommand", () => {
  it("uses the package manager that ran the CLI", () => {
    expect(installCommand("npm").join(" ")).toBe("npm install --global @django-stack/cli@latest");
    expect(installCommand("pnpm").join(" ")).toBe("pnpm add --global @django-stack/cli@latest");
    expect(installCommand("bun").join(" ")).toBe("bun add --global @django-stack/cli@latest");
  });
});

describe("the answer", () => {
  it("is saved and keeps other settings", () => {
    const path = join(root, "config", "django-stack", "config.json");
    expect(readInstallAnswer(path)).toBe(undefined);
    saveInstallAnswer("declined", path);
    expect(readInstallAnswer(path)).toBe("declined");
    writeFileSync(path, JSON.stringify({ other: 1, globalInstall: "declined" }));
    saveInstallAnswer("installed", path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ other: 1, globalInstall: "installed" });
  });
});

describe("shouldOffer", () => {
  const base = { runner: "npm" as const, onPath: false, answer: undefined, interactive: true, env: {} };
  it("asks npx users once, in a terminal", () => {
    expect(shouldOffer(base)).toBe(true);
    expect(shouldOffer({ ...base, runner: undefined })).toBe(false);
    expect(shouldOffer({ ...base, onPath: true })).toBe(false);
    expect(shouldOffer({ ...base, answer: "declined" })).toBe(false);
    expect(shouldOffer({ ...base, answer: "failed" })).toBe(false);
    expect(shouldOffer({ ...base, interactive: false })).toBe(false);
    expect(shouldOffer({ ...base, env: { CI: "true" } })).toBe(false);
    expect(shouldOffer({ ...base, env: { DJANGO_STACK_NO_INSTALL_PROMPT: "1" } })).toBe(false);
    expect(shouldOffer({ ...base, env: { DJANGO_STACK_NO_INSTALL_PROMPT: "0" } })).toBe(true);
  });
});

describe("explainFailure", () => {
  it("explains permission errors with a fix", () => {
    expect(explainFailure("npm", "npm error code EACCES\nnpm error syscall mkdir")).toMatch(
      /No permission .*resolving-eacces/,
    );
    expect(
      explainFailure("pnpm", "ERR_PNPM_NO_GLOBAL_BIN_DIR Unable to find the global bin directory"),
    ).toMatch(/pnpm setup/);
    expect(explainFailure("npm", "npm error 404 Not Found")).toMatch(/404 Not Found .*npm install --global/);
  });
});

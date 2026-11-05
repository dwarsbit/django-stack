import { describe, expect, it } from "vitest";
import { atLeast, checkDevTools, checkDocker, parseVersion, type Run } from "../src/tools";

/** A command runner that answers from a table of `cmd args` to output. */
function runner(outputs: Record<string, string>): Run {
  return (cmd, args) => outputs[[cmd, ...args].join(" ")];
}

describe("versions", () => {
  it("parses versions from command output", () => {
    expect(parseVersion("Python 3.13.1")).toBe("3.13.1");
    expect(parseVersion("v22.11.0")).toBe("22.11.0");
    expect(parseVersion("Docker version 27.3.1, build ce12230")).toBe("27.3.1");
    expect(parseVersion(undefined)).toBeUndefined();
  });

  it("compares by number per part", () => {
    expect(atLeast("3.12.0", "3.12")).toBe(true);
    expect(atLeast("3.9.18", "3.12")).toBe(false);
    expect(atLeast("22.0.0", "22")).toBe(true);
    expect(atLeast("20.18.1", "22")).toBe(false);
  });
});

describe("checkDocker", () => {
  it("passes when Docker runs with Compose v2", () => {
    const checks = checkDocker({
      run: runner({
        "docker --version": "Docker version 27.3.1, build ce12230",
        "docker version --format {{.Server.Version}}": "27.3.1",
        "docker compose version --short": "2.30.3",
      }),
    });
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it("explains how to install Docker per platform", () => {
    const [mac] = checkDocker({ run: runner({}), platform: "darwin" });
    expect(mac).toMatchObject({ name: "Docker is installed", ok: false });
    expect(mac?.help?.join("\n")).toContain("brew install --cask docker");
    const [windows] = checkDocker({ run: runner({}), platform: "win32" });
    expect(windows?.help?.join("\n")).toContain("winget install Docker.DockerDesktop");
  });

  it("tells you to start a stopped daemon", () => {
    const [running] = checkDocker({
      run: runner({ "docker --version": "Docker version 27.3.1" }),
      platform: "linux",
    });
    expect(running).toMatchObject({ name: "Docker is running", ok: false });
    expect(running?.help?.[0]).toContain("systemctl start docker");
  });
});

describe("checkDevTools", () => {
  it("passes with recent Node.js and Python", () => {
    const checks = checkDevTools({
      run: runner({ "node --version": "v22.11.0", "python3 --version": "Python 3.13.1" }),
    });
    expect(checks.map((check) => check.ok)).toEqual([true, true]);
  });

  it("only warns about an old Node.js and a missing Python", () => {
    const [node, python] = checkDevTools({
      run: runner({ "node --version": "v20.18.1" }),
      platform: "darwin",
    });
    expect(node).toMatchObject({ ok: false, warning: true, detail: "Node.js 20.18.1" });
    expect(node?.help?.[0]).toContain("brew install fnm");
    expect(python).toMatchObject({ ok: false, warning: true, detail: "Python was not found." });
    expect(python?.help?.[0]).toContain("brew install uv");
  });

  it("finds Python as py on Windows and suggests uv when it is installed", () => {
    const [, found] = checkDevTools({
      run: runner({ "py -3 --version": "Python 3.12.7" }),
      platform: "win32",
    });
    expect(found?.ok).toBe(true);
    const [, old] = checkDevTools({
      run: runner({ "python3 --version": "Python 3.10.12", "uv --version": "uv 0.5.0" }),
    });
    expect(old?.help).toEqual(["Install it with uv: uv python install 3.13"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  atLeast,
  checkDevTools,
  checkDocker,
  dockerNotRunning,
  dockerRunning,
  isDockerDown,
  leftoverVolumes,
  parseVersion,
  type Run,
  removeLeftovers,
} from "../src/tools";

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

describe("Docker not running", () => {
  it("recognizes the daemon errors of each platform", () => {
    expect(
      isDockerDown(
        "failed to connect to the docker API at unix:///Users/leon/.docker/run/docker.sock; check if the path is correct and if the daemon is running",
      ),
    ).toBe(true);
    expect(isDockerDown("Cannot connect to the Docker daemon at unix:///var/run/docker.sock.")).toBe(true);
    expect(isDockerDown("error during connect: Get http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.47/info")).toBe(
      true,
    );
    expect(isDockerDown("Bind for 127.0.0.1:3000 failed: port is already allocated")).toBe(false);
  });

  it("asks the daemon for its version", () => {
    expect(dockerRunning(runner({ "docker version --format {{.Server.Version}}": "27.3.1" }))).toBe(true);
    expect(dockerRunning(runner({}))).toBe(false);
  });

  it("says so in one line with how to start it", () => {
    expect(dockerNotRunning("darwin")).toBe(
      "Docker not running. Open Docker Desktop and wait until it says it is running.",
    );
    expect(dockerNotRunning("linux")).toBe("Docker not running. Start it: sudo systemctl start docker");
  });
});

describe("leftover project data", () => {
  const label = "label=com.docker.compose.project=my-site";

  it("lists the volumes of an earlier project with the same name", () => {
    const run = runner({ [`docker volume ls --quiet --filter ${label}`]: "my-site_pgdata\nmy-site_media" });
    expect(leftoverVolumes("my-site", run)).toEqual(["my-site_pgdata", "my-site_media"]);
    expect(
      leftoverVolumes("my-site", runner({ [`docker volume ls --quiet --filter ${label}`]: "" })),
    ).toEqual([]);
    expect(leftoverVolumes("my-site", runner({}))).toEqual([]);
  });

  it("removes the containers first, then the volumes", () => {
    const calls: string[] = [];
    const run: Run = (cmd, args) => {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      return line.startsWith("docker ps") ? "abc\ndef" : "ok";
    };
    expect(removeLeftovers("my-site", ["my-site_pgdata"], run)).toBe(true);
    expect(calls).toEqual([
      `docker ps --all --quiet --filter ${label}`,
      "docker rm --force abc def",
      "docker volume rm my-site_pgdata",
    ]);
    expect(removeLeftovers("my-site", ["my-site_pgdata"], runner({}))).toBe(false);
  });
});

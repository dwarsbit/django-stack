import { describe, expect, it } from "vitest";
import {
  type Ask,
  composeName,
  composeState,
  deployId,
  deployScript,
  envValue,
  formatTarget,
  parseComposePs,
  parseTarget,
  type RunResult,
  recordStatus,
  SshClient,
  ssh,
} from "../src/deploy";

/** A fake ssh that records each call and answers from a list. */
function fakeSsh(...answers: Partial<RunResult>[]) {
  const calls: { args: string[]; input?: string }[] = [];
  const run = async (args: string[], input?: Buffer | string) => {
    calls.push({ args, input: input?.toString() });
    return { code: 0, stdout: "", stderr: "", ...answers.shift() };
  };
  return { calls, run };
}

const script = (call: { args: string[] }) => call.args.at(-1) ?? "";
const ask = { interactive: false, step: () => {} } as unknown as Ask;
const link = {
  provider: "ssh",
  url: "ssh://deploy@example.com",
  project: "/srv/site",
  environment: "production",
  application: "site",
};

describe("SSH targets", () => {
  it("reads the usual forms", () => {
    expect(parseTarget("deploy@example.com")).toEqual({
      user: "deploy",
      host: "example.com",
      port: undefined,
    });
    expect(parseTarget("ssh://deploy@10.0.0.2:2222/")).toEqual({
      user: "deploy",
      host: "10.0.0.2",
      port: 2222,
    });
    expect(parseTarget("myserver")).toEqual({ user: undefined, host: "myserver", port: undefined });
    expect(formatTarget(parseTarget("example.com:22"))).toBe("ssh://example.com:22");
    expect(ssh.target.normalize(" deploy@example.com ")).toBe("ssh://deploy@example.com");
  });

  it("refuses what is not a target", () => {
    for (const value of [
      "",
      "https://example.com/x",
      "a b@example.com",
      "deploy@exa mple.com",
      "x@host:99999",
      "x;rm@host",
    ])
      expect(() => parseTarget(value)).toThrow(/not an SSH target/);
  });
});

describe("SSH helpers", () => {
  it("names the Compose project", () => {
    expect(composeName("My Site")).toBe("my-site");
    expect(composeName("--")).toBe("site");
  });

  it("makes ids that sort by time", () => {
    expect(deployId(new Date("2026-11-05T08:09:10Z"), "abc1234")).toBe("20261105-080910-abc1234");
  });

  it("writes .env values Compose reads back", () => {
    expect(envValue("plain-value_1")).toBe("plain-value_1");
    expect(envValue("smtp+tls://u:p@smtp.example.com:587")).toBe("smtp+tls://u:p@smtp.example.com:587");
    expect(envValue("Site <noreply@example.com>")).toBe("'Site <noreply@example.com>'");
    expect(envValue("it's $HOME")).toBe('"it\'s $$HOME"');
  });

  it("maps the deploy status", () => {
    expect(recordStatus("finished", false)).toBe("finished");
    expect(recordStatus("building", true)).toBe("building");
    expect(recordStatus("building", false)).toBe("failed"); // The process died, such as on a reboot.
    expect(recordStatus("", false)).toBe("failed");
  });

  it("reads docker compose ps in both formats", () => {
    const lines =
      '{"Service":"proxy","State":"running","Health":""}\n{"Service":"db","State":"running","Health":"healthy"}\n';
    expect(parseComposePs(lines)).toHaveLength(2);
    expect(parseComposePs('[{"Service":"proxy","State":"running"}]')).toHaveLength(1);
    expect(composeState(parseComposePs(lines))).toEqual({ state: "running", detail: "2/2 running" });
    expect(
      composeState([
        { Service: "proxy", State: "running" },
        { Service: "backend-prod", State: "running", Health: "unhealthy" },
      ]).state,
    ).toBe("degraded");
    expect(composeState([{ Service: "proxy", State: "exited" }]).state).toBe("stopped");
    expect(composeState([]).state).toBe("stopped");
  });

  it("starts the release and keeps the last releases", () => {
    const text = deployScript(
      "/srv/site",
      "site",
      "20261105-080910-abc1234",
      "20261105-080910-abc1234",
      true,
    );
    expect(text).toContain(
      "docker compose -p 'site' build --no-cache --pull && docker compose -p 'site' up -d --build",
    );
    expect(text).toContain('ln -sfn "releases/20261105-080910-abc1234" "$app/current"');
    expect(text).toContain("tail -n +6");
  });
});

describe("SshClient", () => {
  it("runs scripts with batch mode and the port", async () => {
    const fake = fakeSsh({ stdout: "2.29.1\n27.3.1\n" });
    const client = new SshClient("deploy@example.com:2222", fake.run);
    expect(await client.verify()).toBe("Docker 27.3.1, Compose 2.29.1");
    const args = fake.calls[0]?.args ?? [];
    expect(args.slice(0, 7)).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-p", "2222", "--"]);
    expect(args[7]).toBe("deploy@example.com");
    expect(args[8]).toMatch(/^sh -c '/);
  });

  it("says what is missing on the server", async () => {
    await expect(
      new SshClient("example.com", fakeSsh({ stdout: "missing:docker\n" }).run).verify(),
    ).rejects.toThrow(/no Docker/);
    await expect(
      new SshClient("deploy@example.com", fakeSsh({ stdout: "2.29.1\nmissing:permission\n" }).run).verify(),
    ).rejects.toThrow(/usermod -aG docker deploy/);
  });

  it("explains SSH failures", async () => {
    const fail = (stderr: string) =>
      new SshClient("deploy@example.com", fakeSsh({ code: 255, stderr }).run).verify();
    await expect(fail("Host key verification failed.")).rejects.toThrow(/not in your known_hosts/);
    await expect(fail("@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @")).rejects.toThrow(
      /host key .* changed/,
    );
    await expect(fail("deploy@example.com: Permission denied (publickey).")).rejects.toThrow(/ssh-copy-id/);
    await expect(fail("ssh: connect to host example.com port 22: Connection refused")).rejects.toThrow(
      /Connection refused/,
    );
  });

  it("sets up the directories and uploads the variables", async () => {
    const fake = fakeSsh({ stdout: "ok\n" });
    const client = new SshClient("deploy@example.com", fake.run);
    const ids = await client.setup({
      ask,
      directory: ".",
      name: "My Site",
      branch: "main",
      domain: "example.com",
      env: { SITE_URL: "https://example.com", DEFAULT_FROM_EMAIL: "Site <noreply@example.com>" },
      options: {},
    });
    expect(ids).toEqual({ project: "/srv/my-site", environment: "production", application: "my-site" });
    expect(script(fake.calls[0] ?? { args: [] })).toContain("/srv/my-site/releases");
    expect(fake.calls[1]?.input).toBe(
      "SITE_URL=https://example.com\nDEFAULT_FROM_EMAIL='Site <noreply@example.com>'\n",
    );
    expect(script(fake.calls[1] ?? { args: [] })).toContain("chmod 600");
  });

  it("refuses a directory it cannot write", async () => {
    const fake = fakeSsh({ stdout: "" }, { stdout: "/home/deploy" });
    const client = new SshClient("deploy@example.com", fake.run);
    await expect(
      client.setup({
        ask,
        directory: ".",
        name: "site",
        branch: "main",
        domain: "example.com",
        env: {},
        options: {},
      }),
    ).rejects.toThrow(/sudo chown deploy \/srv\/site.*--path \/home\/deploy\/site/);
  });

  it("uploads HEAD and starts the deploy detached", async () => {
    const fake = fakeSsh({ stdout: "ok\n" }, {}, {});
    const git = (args: string[]) => Buffer.from(args.includes("archive") ? "TAR" : "abc1234\nAdd a page\n");
    const client = new SshClient("deploy@example.com", fake.run, git);
    const id = await client.deploy(link, { force: false, directory: "/work/site" });
    expect(id).toMatch(/^\d{8}-\d{6}-abc1234$/);
    expect(script(fake.calls[0] ?? { args: [] })).toContain("/srv/site/deploy.lock");
    expect(fake.calls[1]?.input).toBe("TAR");
    expect(script(fake.calls[1] ?? { args: [] })).toContain("tar -x -C");
    expect(script(fake.calls[1] ?? { args: [] })).toContain(`/srv/site/releases/${id}`);
    expect(script(fake.calls[2] ?? { args: [] })).toContain("nohup sh");
    expect(fake.calls[2]?.input).toContain("docker compose -p 'site' up -d --build");
  });

  it("refuses to deploy while a deploy runs", async () => {
    const client = new SshClient(
      "deploy@example.com",
      fakeSsh({ stdout: "busy:20261105-080910-abc1234\n" }).run,
      () => Buffer.from("abc1234\nx\n"),
    );
    await expect(client.deploy(link, { force: false, directory: "/work/site" })).rejects.toThrow(
      /still running/,
    );
  });

  it("reads a deploy and its log", async () => {
    const record = JSON.stringify({
      id: "d1",
      release: "d1",
      commit: "abc1234",
      message: "Add a page",
      createdAt: "x",
    });
    const fake = fakeSsh({
      stdout: `${record}\nbuilding 1 2026-11-05T08:10:00Z\n--dstack-8f2c--\nline one\nline two\n`,
    });
    const deployment = await new SshClient("deploy@example.com", fake.run).deployment(link, "d1");
    expect(deployment).toMatchObject({
      id: "d1",
      status: "building",
      commit: "abc1234",
      updatedAt: "2026-11-05T08:10:00Z",
    });
    expect(deployment.log.map((line) => line.text)).toEqual(["line one", "line two"]);
    await expect(new SshClient("deploy@example.com", fake.run).deployment(link, "../x")).rejects.toThrow(
      /Invalid/,
    );
  });

  it("rolls back to the release before the running one", async () => {
    const record = (id: string) => JSON.stringify({ id, release: id, commit: id, createdAt: "x" });
    const fake = fakeSsh(
      {
        stdout: `${record("d3")}\nfinished 0 \n--dstack-8f2c--\n${record("d2")}\nfailed 0 \n--dstack-8f2c--\n${record("d1")}\nfinished 0 \n--dstack-8f2c--\n`,
      },
      { stdout: "releases/d3\n" },
      { stdout: "d1\nd2\nd3\n" },
      { stdout: "ok\n" },
      {},
    );
    const id = await new SshClient("deploy@example.com", fake.run).rollback(link);
    expect(id).toMatch(/-rollback$/);
    expect(fake.calls[4]?.input).toContain('cd "$app/releases/d1"');
  });
});

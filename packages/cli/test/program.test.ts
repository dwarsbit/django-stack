import { describe, expect, it } from "vitest";
import { createProgram } from "../src/program";

function run(args: string[]) {
  const program = createProgram();
  let output = "";
  program.exitOverride();
  for (const cmd of [program, ...program.commands]) {
    cmd.exitOverride();
    cmd.configureOutput({ writeOut: (text) => (output += text), writeErr: (text) => (output += text) });
  }
  try {
    program.parse(args, { from: "user" });
  } catch {}
  return output;
}

describe("program", () => {
  it("lists the commands", () => {
    const help = run(["--help"]);
    for (const name of ["init", "preset", "production", "doctor", "secret", "completion"])
      expect(help).toContain(name);
  });

  it("is called dstack and can skip the install prompt", () => {
    const help = run(["--help"]);
    expect(help).toContain("Usage: dstack");
    expect(help).toContain("--no-install-prompt");
  });

  it("rejects an unknown frontend in one line", () => {
    expect(run(["init", "site", "--frontend", "gatsby"])).toMatch(/Allowed choices are astro/);
  });

  it("has a flag for every stack option", () => {
    const help = run(["init", "--help"]);
    for (const flag of [
      "--preset",
      "--postgres",
      "--analytics",
      "--tasks",
      "--cache",
      "--notifications",
      "--captcha",
      "--storage",
      "--package-manager",
    ])
      expect(help).toContain(flag);
  });

  it("rejects an unknown cache in one line", () => {
    expect(run(["init", "site", "--cache", "memcached"])).toMatch(
      /Allowed choices are database, valkey, off/,
    );
  });

  it("suggests a command for a typo", () => {
    expect(run(["inti"])).toContain("Did you mean init?");
  });

  it("checks the secret length", () => {
    expect(run(["secret", "0"])).toContain("Pass a whole number above 0.");
  });
});

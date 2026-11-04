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
    for (const name of ["init", "production", "doctor", "secret", "completion"]) expect(help).toContain(name);
  });

  it("rejects an unknown frontend in one line", () => {
    expect(run(["init", "site", "--frontend", "gatsby"])).toMatch(/Allowed choices are astro/);
  });

  it("suggests a command for a typo", () => {
    expect(run(["inti"])).toContain("Did you mean init?");
  });

  it("checks the secret length", () => {
    expect(run(["secret", "0"])).toContain("Pass a whole number above 0.");
  });
});

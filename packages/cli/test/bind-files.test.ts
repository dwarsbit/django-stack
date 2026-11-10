import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirectoryFiles } from "../src/deploy/bind-files";
import { boundFiles } from "../src/deploy/bunny-compose";

describe("bind-mounted files", () => {
  it("lists the files of a directory, and nothing for a file", () => {
    const directory = mkdtempSync(join(tmpdir(), "dstack-bind-"));
    mkdirSync(join(directory, "sites"));
    writeFileSync(join(directory, "Caddyfile"), "a");
    writeFileSync(join(directory, "sites", "extra"), "b");
    expect(listDirectoryFiles(directory)).toEqual(["Caddyfile", "sites/extra"]);
    expect(listDirectoryFiles(join(directory, "Caddyfile"))).toBeUndefined();
    expect(listDirectoryFiles(join(directory, "missing"))).toBeUndefined();
  });

  it("maps a directory mount to a file per file", () => {
    const files = boundFiles(
      { type: "bind", source: "/project/caddy", target: "/etc/caddy" },
      { readFile: (path) => `content of ${path}`, listFiles: () => ["Caddyfile"] },
    );
    expect(files).toEqual([
      {
        source: "/project/caddy/Caddyfile",
        target: "/etc/caddy/Caddyfile",
        content: "content of /project/caddy/Caddyfile",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { npmPrefix } from "../src/commands/self-update";

describe("npmPrefix", () => {
  it("is the prefix of a global npm install", () => {
    expect(npmPrefix("file:///usr/local/lib/node_modules/@django-stack/cli/dist/bin.js")).toBe("/usr/local");
    expect(
      npmPrefix("file:///home/me/.nvm/versions/node/v22.11.0/lib/node_modules/@django-stack/cli/dist/bin.js"),
    ).toBe("/home/me/.nvm/versions/node/v22.11.0");
    expect(npmPrefix("file:///home/me/django-stack/packages/cli/dist/bin.js")).toBe(undefined);
  });
});

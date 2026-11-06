import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { settings } from "../src/commands/settings";
import { parseEnv, quoteEnvValue } from "../src/env";
import { productionEnv } from "../src/production";
import { scaffold } from "../src/scaffold";
import { parseAssignments, remainingTodo, settingsToAsk, smtpUrl } from "../src/settings";

const root = mkdtempSync(join(tmpdir(), "django-stack-settings-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function project(): string {
  const directory = join(root, `p${Math.random().toString(36).slice(2)}`);
  scaffold({ directory, name: "site", frontend: "astro", demoContent: true });
  const env = readFileSync(join(directory, ".env"), "utf8");
  writeFileSync(join(directory, ".env.production"), productionEnv(env, { domain: "example.com" }).text);
  return directory;
}

describe("settingsToAsk", () => {
  it("asks for the admin email and the SMTP server of a new production .env", () => {
    const env = parseEnv(readFileSync(join(project(), ".env.production"), "utf8"));
    expect(settingsToAsk(env, {}).map((group) => group.title)).toEqual(["Admin email", "Outgoing mail"]);
  });

  it("asks for S3 with uploads in S3", () => {
    const groups = settingsToAsk(
      { ADMIN_EMAIL: "me@site.org", EMAIL_URL: "smtp+tls://mail.site.org:587" },
      { media: "s3" },
    );
    expect(groups.map((group) => group.title)).toEqual(["S3 for uploads"]);
    expect(groups[0]?.missing({ S3_BUCKET: "media" })).toEqual([
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ]);
  });

  it("asks for nothing when everything is set, and for everything with all", () => {
    const env = { ADMIN_EMAIL: "me@site.org", EMAIL_URL: "smtp+tls://mail.site.org:587" };
    expect(settingsToAsk(env, {})).toEqual([]);
    expect(settingsToAsk(env, {}, true)).toHaveLength(2);
  });
});

describe("smtpUrl", () => {
  it("picks the scheme by port and encodes the credentials", () => {
    expect(
      smtpUrl({ host: "smtp.site.org", port: "587", username: "me@site.org", password: "p@ss/word" }),
    ).toBe("smtp+tls://me%40site.org:p%40ss%2Fword@smtp.site.org:587");
    expect(smtpUrl({ host: "smtp.site.org", port: "465" })).toBe("smtps://smtp.site.org:465");
    expect(smtpUrl({ host: "relay", port: "25", username: "u" })).toBe("smtp://u@relay:25");
  });
});

describe("parseAssignments", () => {
  it("takes NAME=value for the settings only", () => {
    expect(parseAssignments(["S3_SECRET_ACCESS_KEY=a=b"])).toEqual({ S3_SECRET_ACCESS_KEY: "a=b" });
    expect(() => parseAssignments(["DJANGO_SECRET_KEY=x"])).toThrow(/is not NAME=value/);
    expect(() => parseAssignments(["ADMIN_EMAIL=nope"])).toThrow(/email address/);
  });
});

describe("remainingTodo", () => {
  it("drops the items the settings did", () => {
    const todo = [
      "Set EMAIL_URL to your SMTP server.",
      "Set ADMIN_EMAIL to your address.",
      "Set SEED_DEMO_CONTENT=0.",
    ];
    expect(remainingTodo(todo, { EMAIL_URL: "smtps://mail.site.org:465", ADMIN_EMAIL: "" })).toEqual([
      "Set ADMIN_EMAIL to your address.",
      "Set SEED_DEMO_CONTENT=0.",
    ]);
  });
});

describe("quoteEnvValue", () => {
  it("quotes what Compose would change", () => {
    expect(quoteEnvValue("abc/+=")).toBe("abc/+=");
    expect(quoteEnvValue("site <noreply@site.org>")).toBe("site <noreply@site.org>");
    expect(quoteEnvValue("pa$$word")).toBe("'pa$$word'");
    expect(quoteEnvValue("a #b")).toBe("'a #b'");
    expect(() => quoteEnvValue("it's $5")).toThrow();
  });
});

describe("dstack settings", () => {
  it("saves values from --set in .env.production", async () => {
    const directory = project();
    await settings({
      dir: directory,
      yes: true,
      set: ["ADMIN_EMAIL=me@site.org", "EMAIL_URL=smtps://u:p@mail.site.org:465"],
    });
    const env = parseEnv(readFileSync(join(directory, ".env.production"), "utf8"));
    expect(env.ADMIN_EMAIL).toBe("me@site.org");
    expect(env.EMAIL_URL).toBe("smtps://u:p@mail.site.org:465");
    expect(readFileSync(join(directory, ".env"), "utf8")).not.toContain("me@site.org");
  });
});

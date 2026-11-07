import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CAPTCHA_CSP, CAPTCHA_STYLE_HASH, captchaEnabled, loadCaptcha } from "../src";

describe("captcha", () => {
  it("has the hash of the widget's style", () => {
    // The widget sets its shadow root to <style>CSS</style>; the hash is of the CSS.
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("@cap.js/widget"), "utf8");
    const tag = source.indexOf("innerHTML=`<style${");
    const start = source.indexOf('""}>', tag) + 4;
    const css = source.slice(start, source.indexOf("</style>", start));
    expect(tag).toBeGreaterThan(0);
    expect(css).toMatch(/^:host\{/);
    const hash = createHash("sha256").update(css).digest("base64");
    expect(CAPTCHA_STYLE_HASH).toBe(`'sha256-${hash}'`);
    expect(CAPTCHA_CSP["style-src"]).toContain(CAPTCHA_STYLE_HASH);
  });

  it("is on unless CAPTCHA is off", () => {
    expect(captchaEnabled(undefined)).toBe(true);
    expect(captchaEnabled("on")).toBe(true);
    expect(captchaEnabled("")).toBe(true);
    expect(captchaEnabled("off")).toBe(false);
    expect(captchaEnabled(" OFF ")).toBe(false);
  });

  it("loads nothing on the server", async () => {
    await expect(loadCaptcha()).resolves.toBeUndefined();
  });
});

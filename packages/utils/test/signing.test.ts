import { describe, expect, it } from "vitest";
import { signPreviewToken, signWebhook, verifyPreviewToken, verifySignature, verifyWebhook } from "../src";

describe("preview tokens", () => {
  it("match the Python package", async () => {
    // The same vector is tested in python/django-stack/tests/test_signing.py.
    expect(await signPreviewToken("secret", 0, 1700000000)).toBe(
      "1700000000.a9da2691080116efe39fd80391b4560625e3a5ffd93a574bd44247ba15687488",
    );
  });

  it("verify and expire", async () => {
    const token = await signPreviewToken("secret", 60, 1000);
    expect(await verifyPreviewToken("secret", token, 1000)).toBe(true);
    expect(await verifyPreviewToken("other", token, 1000)).toBe(false);
    expect(await verifyPreviewToken("secret", token, 2000)).toBe(false);
    expect(await verifyPreviewToken("secret", "1060.bad", 1000)).toBe(false);
    expect(await verifyPreviewToken("secret", null)).toBe(false);
    expect(await verifyPreviewToken(undefined, token)).toBe(false);
  });
});

describe("webhooks", () => {
  it("match the Python package", async () => {
    expect(await signWebhook("secret", '{"a":1}', 1700000000)).toBe(
      "t=1700000000,v1=49f24e537407743fa4a0242bb63b94b9a47ee99cbbe071ccd8a22550ae411686",
    );
  });

  it("verify signatures", async () => {
    const header = await signWebhook("secret", "body", 1000);
    expect(await verifySignature("secret", header, "body", { now: 1000 })).toBe(true);
    expect(await verifySignature("secret", header, "other", { now: 1000 })).toBe(false);
    expect(await verifySignature("secret", header, "body", { now: 5000 })).toBe(false);
    expect(await verifySignature("secret", "nonsense", "body", { now: 1000 })).toBe(false);
  });

  it("verify requests", async () => {
    const body = JSON.stringify({ version: 1, event: "content.changed", changes: [] });
    const request = new Request("http://frontend/api/revalidate", {
      method: "POST",
      body,
      headers: { "X-Django-Stack-Signature": await signWebhook("secret", body) },
    });
    const result = await verifyWebhook(request, "secret");
    expect(result.valid).toBe(true);
    expect(result.payload?.event).toBe("content.changed");

    const forged = new Request("http://frontend/api/revalidate", { method: "POST", body });
    expect((await verifyWebhook(forged, "secret")).valid).toBe(false);
  });
});

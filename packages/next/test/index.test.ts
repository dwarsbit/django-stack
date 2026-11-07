import { seo, signPreviewToken, signWebhook } from "@django-stack/utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { revalidateTag } = await import("next/cache");
const {
  CONTENT_TAG,
  contentFetchInit,
  contentSecurityPolicy,
  exitPreviewHandler,
  mediaOrigins,
  PREVIEW_COOKIE,
  previewHandler,
  revalidateHandler,
  toMetadata,
  VERSION,
} = await import("../src/index");

describe("package", () => {
  it("has a version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("contentFetchInit", () => {
  it("caches with the content tag, except in preview", () => {
    expect(contentFetchInit({ ttl: 60 })).toEqual({
      cache: "force-cache",
      next: { tags: [CONTENT_TAG], revalidate: 60 },
    });
    expect(contentFetchInit({ ttl: 60, preview: true })).toEqual({ cache: "no-store" });
    expect(contentFetchInit({ ttl: 0 })).toEqual({ cache: "no-store" });
  });
});

describe("revalidateHandler", () => {
  it("expires the content tag for a signed request only", async () => {
    const handler = revalidateHandler({ secret: "s3cret" });
    const body = JSON.stringify({ changes: [{ model: "content.page", id: 1 }] });

    const unsigned = await handler(new Request("http://site/revalidate", { method: "POST", body }));
    expect(unsigned.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();

    const signature = await signWebhook("s3cret", body);
    const signed = await handler(
      new Request("http://site/revalidate", {
        method: "POST",
        body,
        headers: { "X-Django-Stack-Signature": signature },
      }),
    );
    expect(signed.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith(CONTENT_TAG, { expire: 0 });
  });
});

describe("preview", () => {
  it("sets the cookie for a valid token and stays on the site", async () => {
    const token = await signPreviewToken("s3cret");
    const handler = previewHandler({ secret: "s3cret" });
    const response = await handler(new Request(`http://site/preview?token=${token}&path=//evil.example`));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toContain(`${PREVIEW_COOKIE}=${token}`);

    const invalid = await handler(new Request("http://site/preview?token=1.abc&path=/about"));
    expect(invalid.status).toBe(401);
  });

  it("removes the cookie on exit", async () => {
    const response = await exitPreviewHandler()();
    expect(response.headers.get("Set-Cookie")).toContain(`${PREVIEW_COOKIE}=;`);
  });
});

describe("headers and metadata", () => {
  it("allows media origins and the nonce in the policy", () => {
    const origins = mediaOrigins("https://cdn.example/media/, nonsense");
    expect(origins).toEqual(["https://cdn.example"]);
    const policy = contentSecurityPolicy({ nonce: "abc", mediaOrigins: origins });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).toContain("img-src 'self' data: https://cdn.example");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("worker-src");
  });

  it("allows the captcha widget", () => {
    const policy = contentSecurityPolicy({ nonce: "abc", captcha: true });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(policy).toMatch(/style-src 'self' 'nonce-abc' 'sha256-[^']+'/);
    expect(policy).toContain("worker-src 'self' blob:");
  });

  it("turns the SEO tags into metadata", () => {
    const metadata = toMetadata(
      seo({ page: { title: "About" }, settings: null, siteUrl: "https://site.example", path: "/about" }),
    );
    expect(metadata.title).toBe("About");
    expect(metadata.alternates?.canonical).toBe("https://site.example/about");
  });
});

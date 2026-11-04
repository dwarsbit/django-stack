import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, createContent, linkHref } from "../src";

function fakeFetch(responses: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const key = url.pathname + url.search;
    const match = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
    const headers = new Headers(init?.headers);
    if (headers.get("X-Secret-Key") !== "read-key") {
      return new Response(JSON.stringify({ detail: "no" }), { status: 401 });
    }
    if (!match) return new Response(JSON.stringify({ detail: "Not found." }), { status: 404 });
    return new Response(JSON.stringify(match[1].body), {
      status: match[1].status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createClient", () => {
  it("reads the environment", () => {
    expect(() => createClient({ env: {} })).toThrow(/API_URL/);
    expect(createClient({ env: { API_URL: "http://backend:8000/api/", API_READ_KEY: "k" } })).toBeTruthy();
  });

  it("refuses a key in the browser", () => {
    vi.stubGlobal("window", {});
    expect(() => createClient({ env: { API_URL: "http://x/api", API_READ_KEY: "k" } })).toThrow(
      /server only/,
    );
  });

  it("sends the preview token", async () => {
    const fetch = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const client = createClient({ apiUrl: "http://x/api", apiKey: "k", previewToken: "t", fetch });
    await client.request("GET", "content.page");
    const headers = new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("X-Preview-Token")).toBe("t");
  });
});

describe("createContent", () => {
  const fetch = fakeFetch({
    "/api/content.page?path=about%2Fteam": { body: { pagination: {}, data: [{ id: 3, title: "Team" }] } },
    "/api/content.page?path=missing": { body: { pagination: {}, data: [] } },
    "/api/content.sitesettings": { body: { id: 1, site_name: "Site", home_page: 1 } },
    "/api/content.page/1": { body: { id: 1, title: "Home", path: "home" } },
    "/api/content.post?": { body: { pagination: { count: 0 }, data: [] } },
  });
  const content = createContent(createClient({ apiUrl: "http://backend/api", apiKey: "read-key", fetch }));

  it("gets pages by path", async () => {
    expect((await content.getPage("/about/team/"))?.title).toBe("Team");
    expect(await content.getPage("missing")).toBeNull();
  });

  it("gets the home page from the settings", async () => {
    expect((await content.getHomePage())?.title).toBe("Home");
  });

  it("filters posts", async () => {
    await content.getPosts({ category: "news", page: 2 });
    const url = String(fetch.mock.calls.at(-1)?.[0]);
    expect(url).toContain("categories__slug=news");
    expect(url).toContain("page=2");
  });
});

describe("linkHref", () => {
  it("prefers the page", () => {
    expect(linkHref({ value: { page: { url: "/about" }, url: "" } })).toBe("/about");
    expect(linkHref({ value: { page: null, url: "https://x.org" } })).toBe("https://x.org");
  });
});

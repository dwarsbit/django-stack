import { describe, expect, it } from "vitest";
import { getCached, purgeAll, store } from "../src/lib/cache";

describe("page cache", () => {
  it("stores, serves and purges pages", async () => {
    purgeAll();
    expect(getCached("/about")).toBeNull();
    const response = await store(
      "/about",
      new Response("<h1>About</h1>", { headers: { "Content-Type": "text/html" } }),
    );
    expect(response.headers.get("X-Cache")).toBe("MISS");
    expect(await response.text()).toBe("<h1>About</h1>");

    const hit = getCached("/about");
    expect(hit?.headers.get("X-Cache")).toBe("HIT");
    expect(await hit?.text()).toBe("<h1>About</h1>");

    expect(purgeAll()).toBe(1);
    expect(getCached("/about")).toBeNull();
  });
});

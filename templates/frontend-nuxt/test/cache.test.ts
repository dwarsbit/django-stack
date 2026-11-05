import { describe, expect, it } from "vitest";
import { cached, getCached, purgeAll } from "../server/utils/cache";

describe("content cache", () => {
  it("stores, serves and purges content", async () => {
    purgeAll();
    expect(getCached("/_content/page?path=about")).toBeUndefined();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { title: "About" };
    };
    expect(await cached("/_content/page?path=about", load)).toEqual({ title: "About" });
    expect(await cached("/_content/page?path=about", load)).toEqual({ title: "About" });
    expect(loads).toBe(1);

    expect(purgeAll()).toBe(1);
    expect(getCached("/_content/page?path=about")).toBeUndefined();
  });
});

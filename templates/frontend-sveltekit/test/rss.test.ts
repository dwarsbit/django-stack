import { describe, expect, it } from "vitest";
import { rssFeed } from "../src/lib/server/rss";

describe("RSS feed", () => {
  it("lists the posts with absolute links, escaped", () => {
    const xml = rssFeed({
      title: "News & notes",
      description: "",
      site: "https://example.com",
      items: [{ title: "<Hello>", link: "/blog/hello", pubDate: new Date("2026-01-02T03:04:05Z") }],
    });
    expect(xml).toContain("<title>News &amp; notes</title>");
    expect(xml).toContain("<title>&lt;Hello&gt;</title>");
    expect(xml).toContain("<link>https://example.com/blog/hello</link>");
    expect(xml).toContain("<pubDate>Fri, 02 Jan 2026 03:04:05 GMT</pubDate>");
  });
});

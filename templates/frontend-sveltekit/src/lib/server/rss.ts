/** An RSS 2.0 feed. */

export interface FeedItem {
  title: string;
  /** A path on the site, such as /blog/hello-world. */
  link: string;
  description?: string | null;
  pubDate?: Date | null;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function rssFeed(feed: {
  title: string;
  description: string;
  site: string;
  items: FeedItem[];
}): string {
  const items = feed.items.map((item) => {
    const url = escapeXml(new URL(item.link, `${feed.site}/`).href);
    return [
      "    <item>",
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      item.description ? `      <description>${escapeXml(item.description)}</description>` : "",
      item.pubDate ? `      <pubDate>${item.pubDate.toUTCString()}</pubDate>` : "",
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <description>${escapeXml(feed.description)}</description>
    <link>${escapeXml(`${feed.site}/`)}</link>
${items.join("\n")}
  </channel>
</rss>
`;
}

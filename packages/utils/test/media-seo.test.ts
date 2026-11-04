import { describe, expect, it } from "vitest";
import { imageAttributes, imageUrl, type Media, seo } from "../src";

const media: Media = {
  id: "1",
  type: "image",
  name: "Photo",
  alt: "A photo",
  url: "https://example.com/media/photo",
  width: 1600,
  height: 900,
  focal_point: { x: 30, y: 60 },
  sizes: {
    card: { url: "https://example.com/media/card.webp", width: 800, height: 500 },
    content: { url: "https://example.com/media/content.webp", width: 1200, height: 675 },
    share: { url: "https://example.com/media/share.jpg", width: 1200, height: 630 },
  },
};

describe("images", () => {
  it("picks a size", () => {
    expect(imageUrl(media, "card")).toBe("https://example.com/media/card.webp");
    expect(imageUrl(media, "missing")).toBe(media.url);
    expect(imageUrl("1")).toBeNull();
  });

  it("builds img attributes", () => {
    const attributes = imageAttributes(media, { size: "content" });
    expect(attributes).toMatchObject({
      src: "https://example.com/media/content.webp",
      width: 1200,
      height: 675,
      alt: "A photo",
      objectPosition: "30% 60%",
    });
    expect(attributes?.srcset).toBe(
      "https://example.com/media/card.webp 800w, https://example.com/media/content.webp 1200w",
    );
  });
});

describe("seo", () => {
  it("falls back to the site settings", () => {
    const result = seo({
      page: { title: "About", seo_description: "" },
      settings: {
        id: 1,
        site_name: "My site",
        tagline: "",
        logo: null,
        home_page: null,
        seo_description: "Default description",
        share_image: media,
        social_links: {},
        footer_text: "",
      },
      siteUrl: "https://example.com",
      path: "/about",
    });
    expect(result.title).toBe("About | My site");
    expect(result.description).toBe("Default description");
    expect(result.canonical).toBe("https://example.com/about");
    expect(result.openGraph["og:image"]).toBe("https://example.com/media/share.jpg");
    expect(result.twitter["twitter:card"]).toBe("summary_large_image");
  });
});

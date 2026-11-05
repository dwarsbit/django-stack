import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import { Blocks, Seo } from "../src/index";
import Custom from "./Custom.svelte";

const image = {
  id: "1",
  type: "image",
  name: "Photo",
  alt: "A photo",
  url: "http://localhost:3000/media/photo",
  width: 1600,
  height: 900,
  focal_point: null,
  sizes: { content: { url: "http://localhost:3000/media/content.webp", width: 1200, height: 675 } },
};

describe("Blocks", () => {
  it("renders every block type and skips unknown ones", () => {
    const { body } = render(Blocks, {
      props: {
        blocks: [
          { id: "a", type: "text", value: { body: "<p>Hello <strong>world</strong></p>" } },
          { id: "b", type: "image", value: { image, caption: "A caption" } },
          { id: "c", type: "quote", value: { text: "Quoted", attribution: "Someone" } },
          {
            id: "d",
            type: "call_to_action",
            value: { title: "Act", text: "", button_label: "Go", button_url: "/go" },
          },
          { id: "e", type: "unknown", value: {} },
        ],
      },
    });
    expect(body).toContain("<strong>world</strong>");
    expect(body).toContain('src="http://localhost:3000/media/content.webp"');
    expect(body).toContain('alt="A photo"');
    expect(body).toContain("A caption");
    expect(body).toContain("Quoted");
    expect(body).toContain('href="/go"');
  });

  it("renders added block types", () => {
    const { body } = render(Blocks, {
      props: {
        blocks: [{ id: "a", type: "gallery", value: { title: "Holiday" } }],
        components: { gallery: Custom },
      },
    });
    expect(body).toContain("Gallery: Holiday");
  });
});

describe("Seo", () => {
  it("writes the head tags", () => {
    const { head } = render(Seo, {
      props: {
        page: { title: "About", seo_description: "Who we are" },
        settings: null,
        siteUrl: "https://example.com",
        path: "/about",
      },
    });
    expect(head).toContain("<title>About</title>");
    expect(head).toContain('content="Who we are"');
    expect(head).toContain('href="https://example.com/about"');
  });
});

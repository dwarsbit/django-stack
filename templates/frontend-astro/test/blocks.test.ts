import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Blocks from "../src/components/Blocks.astro";

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
  it("renders every block type and skips unknown ones", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Blocks, {
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
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain('src="http://localhost:3000/media/content.webp"');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain("A caption");
    expect(html).toContain("Quoted");
    expect(html).toContain('href="/go"');
  });
});

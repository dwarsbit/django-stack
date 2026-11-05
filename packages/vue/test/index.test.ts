import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { Blocks, Image } from "../src/index";

const image = {
  id: "1",
  type: "image",
  name: "Photo",
  alt: "A photo",
  url: "http://localhost:3000/media/photo",
  width: 1600,
  height: 900,
  focal_point: { x: 0.25, y: 0.75 },
  sizes: { content: { url: "http://localhost:3000/media/content.webp", width: 1200, height: 675 } },
};

const render = (component: Parameters<typeof h>[0], props: Record<string, unknown>) =>
  renderToString(h(component, props));

describe("Blocks", () => {
  it("renders every block type and skips unknown ones", async () => {
    const html = await render(Blocks, {
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
    });
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain('src="http://localhost:3000/media/content.webp"');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain("A caption");
    expect(html).toContain("Quoted");
    expect(html).toContain('href="/go"');
  });

  it("renders added block types", async () => {
    const Gallery = defineComponent({
      props: { block: { type: Object, required: true } },
      setup: (props) => () => h("p", `Gallery: ${props.block.value.title}`),
    });
    const html = await render(Blocks, {
      blocks: [{ id: "a", type: "gallery", value: { title: "Holiday" } }],
      components: { gallery: Gallery },
    });
    expect(html).toContain("Gallery: Holiday");
  });
});

describe("Image", () => {
  it("renders nothing without media", async () => {
    expect(await render(Image, { media: null })).toBe("<!---->");
  });
});

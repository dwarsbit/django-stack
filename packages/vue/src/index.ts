import {
  type Block,
  type CallToActionBlock as CallToActionBlockData,
  type ImageBlock as ImageBlockData,
  imageAttributes,
  type Media,
  type QuoteBlock as QuoteBlockData,
  type TextBlock as TextBlockData,
} from "@django-stack/utils";
import { type Component, defineComponent, h, type PropType } from "vue";

/**
 * A responsive image from Django Headless: `srcset` from the image sizes and
 * the focal point as `object-position`.
 */
export const Image = defineComponent({
  name: "StackImage",
  props: {
    media: { type: [Object, String, null] as PropType<Media | string | null | undefined>, default: null },
    /** An image size from IMAGE_SIZES, such as card or hero. */
    size: { type: String, default: undefined },
    /** The sizes attribute, for the browser to pick from the srcset. */
    sizes: { type: String, default: "100vw" },
    alt: { type: String, default: undefined },
    eager: { type: Boolean, default: false },
  },
  setup(props) {
    return () => {
      const attributes = imageAttributes(props.media, { size: props.size, alt: props.alt });
      if (!attributes) return null;
      return h("img", {
        src: attributes.src,
        srcset: attributes.srcset,
        sizes: attributes.srcset ? props.sizes : undefined,
        width: attributes.width,
        height: attributes.height,
        alt: attributes.alt,
        style: attributes.objectPosition ? { objectPosition: attributes.objectPosition } : undefined,
        loading: props.eager ? "eager" : "lazy",
        decoding: "async",
      });
    };
  },
});

/**
 * HTML from a Content Studio HTMLField. Django sanitizes it with an
 * allowlist when it is saved, so it is safe to render as is.
 */
export const RichText = defineComponent({
  name: "StackRichText",
  props: {
    html: { type: String as PropType<string | null | undefined>, default: null },
  },
  setup(props, { attrs }) {
    return () => (props.html ? h("div", { class: attrs.class ?? "prose", innerHTML: props.html }) : null);
  },
  inheritAttrs: false,
});

export const TextBlock = defineComponent({
  name: "StackTextBlock",
  props: { block: { type: Object as PropType<TextBlockData>, required: true } },
  setup(props) {
    return () => h(RichText, { html: props.block.value.body });
  },
});

export const ImageBlock = defineComponent({
  name: "StackImageBlock",
  props: { block: { type: Object as PropType<ImageBlockData>, required: true } },
  setup(props) {
    return () =>
      h("figure", { class: "block-image" }, [
        h(Image, {
          media: props.block.value.image,
          size: "content",
          sizes: "(min-width: 48rem) 44rem, 100vw",
        }),
        props.block.value.caption ? h("figcaption", { class: "muted" }, props.block.value.caption) : null,
      ]);
  },
});

export const QuoteBlock = defineComponent({
  name: "StackQuoteBlock",
  props: { block: { type: Object as PropType<QuoteBlockData>, required: true } },
  setup(props) {
    return () =>
      h("blockquote", { class: "prose" }, [
        h("p", props.block.value.text),
        props.block.value.attribution ? h("footer", { class: "muted" }, props.block.value.attribution) : null,
      ]);
  },
});

export const CallToActionBlock = defineComponent({
  name: "StackCallToActionBlock",
  props: { block: { type: Object as PropType<CallToActionBlockData>, required: true } },
  setup(props) {
    return () =>
      h("aside", { class: "cta" }, [
        h("h2", props.block.value.title),
        props.block.value.text ? h("p", props.block.value.text) : null,
        h("a", { class: "button", href: props.block.value.button_url }, props.block.value.button_label),
      ]);
  },
});

/** The components of the built-in block types, by type. */
export const BLOCK_COMPONENTS: Record<string, Component> = {
  text: TextBlock,
  image: ImageBlock,
  quote: QuoteBlock,
  call_to_action: CallToActionBlock,
};

/**
 * Renders a Content Studio block field. `components` maps a block type to a
 * component that takes a `block` prop; it adds types or replaces the
 * built-in ones. Unknown types render nothing.
 */
export const Blocks = defineComponent({
  name: "StackBlocks",
  props: {
    blocks: { type: Array as PropType<Block[] | null | undefined>, default: null },
    components: { type: Object as PropType<Record<string, Component>>, default: () => ({}) },
  },
  setup(props) {
    return () => {
      const registry = { ...BLOCK_COMPONENTS, ...props.components };
      return (props.blocks ?? []).map((block) => {
        const component = registry[block.type];
        return component ? h(component, { block, key: block.id }) : null;
      });
    };
  },
});

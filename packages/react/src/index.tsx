import {
  type Block,
  CAPTCHA_ATTRIBUTES,
  type CallToActionBlock as CallToActionBlockData,
  type ImageBlock as ImageBlockData,
  imageAttributes,
  loadCaptcha,
  type Media,
  type QuoteBlock as QuoteBlockData,
  safeHref,
  type TextBlock as TextBlockData,
} from "@django-stack/utils";
import { type ComponentType, createElement, useEffect } from "react";
import { version } from "../package.json";

/** The version of this package, the same for every @django-stack package. */
export const VERSION: string = version;

export interface ImageProps {
  media: Media | string | null | undefined;
  /** An image size from IMAGE_SIZES, such as card or hero. */
  size?: string;
  /** The sizes attribute, for the browser to pick from the srcset. */
  sizes?: string;
  alt?: string;
  className?: string;
  eager?: boolean;
}

/**
 * A responsive image from Django Headless: `srcset` from the image sizes and
 * the focal point as `object-position`.
 */
export function Image({ media, size, sizes = "100vw", alt, className, eager = false }: ImageProps) {
  const attributes = imageAttributes(media, { size, alt });
  if (!attributes) return null;
  return (
    <img
      src={attributes.src}
      srcSet={attributes.srcset}
      sizes={attributes.srcset ? sizes : undefined}
      width={attributes.width}
      height={attributes.height}
      alt={attributes.alt}
      className={className}
      style={attributes.objectPosition ? { objectPosition: attributes.objectPosition } : undefined}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

/**
 * HTML from a Content Studio HTMLField. Django sanitizes it with an
 * allowlist when it is saved, so it is safe to render as is.
 */
export function RichText({
  html,
  className = "prose",
}: {
  html: string | null | undefined;
  className?: string;
}) {
  if (!html) return null;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Django sanitizes the HTML when it is saved.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TextBlock({ block }: { block: TextBlockData }) {
  return <RichText html={block.value.body} />;
}

export function ImageBlock({ block }: { block: ImageBlockData }) {
  return (
    <figure className="block-image">
      <Image media={block.value.image} size="content" sizes="(min-width: 48rem) 44rem, 100vw" />
      {block.value.caption ? <figcaption className="muted">{block.value.caption}</figcaption> : null}
    </figure>
  );
}

export function QuoteBlock({ block }: { block: QuoteBlockData }) {
  return (
    <blockquote className="prose">
      <p>{block.value.text}</p>
      {block.value.attribution ? <footer className="muted">{block.value.attribution}</footer> : null}
    </blockquote>
  );
}

export function CallToActionBlock({ block }: { block: CallToActionBlockData }) {
  return (
    <aside className="cta">
      <h2>{block.value.title}</h2>
      {block.value.text ? <p>{block.value.text}</p> : null}
      <a className="button" href={safeHref(block.value.button_url)}>
        {block.value.button_label}
      </a>
    </aside>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: each component takes its own block type.
export type BlockComponents = Record<string, ComponentType<{ block: any }>>;

/** The components of the built-in block types, by type. */
export const BLOCK_COMPONENTS: BlockComponents = {
  text: TextBlock,
  image: ImageBlock,
  quote: QuoteBlock,
  call_to_action: CallToActionBlock,
};

/**
 * Renders a Content Studio block field. `components` maps a block type to a
 * component that takes a `block` prop; it adds types or replaces the
 * built-in ones. Unknown types render nothing. Works in server components.
 */
export function Blocks({
  blocks,
  components = {},
}: {
  blocks: Block[] | null | undefined;
  components?: BlockComponents;
}) {
  const registry = { ...BLOCK_COMPONENTS, ...components };
  return (
    <>
      {(blocks ?? []).map((block) => {
        const Component = registry[block.type];
        return Component ? <Component key={block.id} block={block} /> : null;
      })}
    </>
  );
}

export interface CaptchaProps {
  className?: string;
}

/**
 * The captcha widget, for a form that posts to a route in PUBLIC_CREATE: it
 * adds a hidden `captcha` field with the token once the visitor verified.
 * Use it in a client component. After a submission, call `resetCaptcha(form)`
 * from @django-stack/utils: a token is valid once.
 */
export function Captcha({ className }: CaptchaProps) {
  useEffect(() => {
    void loadCaptcha();
  }, []);
  return createElement("cap-widget", {
    ...CAPTCHA_ATTRIBUTES,
    class: className,
    suppressHydrationWarning: true,
  });
}

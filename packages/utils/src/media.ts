import type { Media } from "./types";

export interface ImageAttributes {
  src: string;
  srcset?: string;
  width?: number;
  height?: number;
  alt: string;
  /** The focal point as a CSS object-position, such as `30% 60%`. */
  objectPosition?: string;
}

function isMedia(value: unknown): value is Media {
  return typeof value === "object" && value !== null && "url" in value && "sizes" in value;
}

/** The URL of an image in one of its sizes (see IMAGE_SIZES), or of the original. */
export function imageUrl(media: Media | string | null | undefined, size?: string): string | null {
  if (!isMedia(media)) return null;
  if (size && media.sizes[size]) return media.sizes[size].url;
  return media.url;
}

/**
 * The attributes of an `<img>` for a media item: `src` in the given size,
 * `srcset` with every size that has a width, and the focal point.
 */
export function imageAttributes(
  media: Media | string | null | undefined,
  options: { size?: string; alt?: string; sizes?: string[] } = {},
): ImageAttributes | null {
  if (!isMedia(media) || !media.url) return null;
  const chosen = options.size ? media.sizes[options.size] : undefined;
  const candidates = Object.entries(media.sizes)
    .filter(([name, size]) => size.width && (!options.sizes || options.sizes.includes(name)))
    .map(([, size]) => size)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const unique = candidates.filter(
    (size, index) => candidates.findIndex((other) => other.width === size.width) === index,
  );

  const attributes: ImageAttributes = {
    src: chosen?.url ?? media.url,
    alt: options.alt ?? media.alt ?? "",
  };
  const width = chosen?.width ?? media.width;
  const height = chosen?.height ?? media.height;
  if (width) attributes.width = width;
  if (height) attributes.height = height;
  if (unique.length > 0) attributes.srcset = unique.map((size) => `${size.url} ${size.width}w`).join(", ");
  if (media.focal_point) attributes.objectPosition = `${media.focal_point.x}% ${media.focal_point.y}%`;
  return attributes;
}

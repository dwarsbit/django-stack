/**
 * Types of the API responses of the starter content model. Projects that
 * change their models generate exact types with `pnpm generate:types`.
 */

export interface ImageSize {
  url: string;
  width: number | null;
  height: number | null;
}

/** A media library item, as DjangoStack's serializer returns it. */
export interface Media {
  id: string;
  type: "image" | "video" | "audio" | "file";
  name: string;
  alt: string;
  url: string | null;
  width: number | null;
  height: number | null;
  focal_point: { x: number; y: number } | null;
  sizes: Record<string, ImageSize>;
}

/** A related object inside a block: its primary key, name and URL on the site. */
export interface RelatedObject {
  id: string | number;
  label: string;
  url?: string;
}

/** One block of a Content Studio block field. */
export interface Block<T extends string = string, V = Record<string, unknown>> {
  id: string;
  type: T;
  value: V;
}

export type TextBlock = Block<"text", { body: string }>;
export type ImageBlock = Block<"image", { image: Media | null; caption: string }>;
export type QuoteBlock = Block<"quote", { text: string; attribution: string }>;
export type CallToActionBlock = Block<
  "call_to_action",
  { title: string; text: string; button_label: string; button_url: string }
>;
export type LinkBlock = Block<"link", { label: string; page: RelatedObject | null; url: string }>;

export interface Publishable {
  status: "draft" | "published";
  published_at: string | null;
}

export interface SeoFields {
  seo_title: string;
  seo_description: string;
  share_image: Media | string | null;
}

export interface Page extends Publishable, SeoFields {
  id: number;
  title: string;
  slug: string;
  path: string;
  parent: number | null;
  order: number;
  body: Block[];
}

export interface Taxonomy {
  id: number;
  name: string;
  slug: string;
  description?: string;
}

export interface Author {
  id: number;
  name: string;
  slug: string;
  bio: string;
  avatar: Media | string | null;
}

export interface Post extends Publishable, SeoFields {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  cover: Media | string | null;
  body: Block[];
  author: Author | number | null;
  categories: (Taxonomy | number)[];
  tags: (Taxonomy | number)[];
}

export interface Menu {
  id: number;
  name: string;
  slug: string;
  items: LinkBlock[];
}

export interface SiteSettings {
  id: number;
  site_name: string;
  tagline: string;
  logo: Media | string | null;
  home_page: number | null;
  seo_description: string;
  share_image: Media | string | null;
  social_links: Record<string, string>;
  footer_text: string;
}

export interface Redirect {
  id: number;
  old_path: string;
  new_path: string;
  permanent: boolean;
}

export interface Paginated<T> {
  pagination: {
    count: number;
    pages: number;
    current: number;
    limit: number;
    links: { self: string; next: string | null; previous: string | null };
  };
  data: T[];
}

import { type DjangoRestClient, DjangoRestError } from "@django-headless/client";
import type { Menu, Page, Paginated, Post, Redirect, SiteSettings, Taxonomy } from "./types";

/** The model labels of the starter content model; change them when your models differ. */
export const DEFAULT_LABELS = {
  page: "content.page",
  post: "content.post",
  category: "content.category",
  tag: "content.tag",
  menu: "content.menu",
  redirect: "content.redirect",
  siteSettings: "content.sitesettings",
} as const;

export type ContentLabels = { [K in keyof typeof DEFAULT_LABELS]: string };

export interface GetPostsOptions {
  page?: number;
  limit?: number;
  category?: string;
  tag?: string;
  author?: string;
  search?: string;
}

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof DjangoRestError && error.status === 404) return null;
    throw error;
  }
}

// The client's types are generated per project; the helpers only need these methods.
type Params = Record<string, unknown>;
interface LooseModel {
  retrieve(id: unknown, params?: Params): Promise<unknown>;
  retrieveBy(field: string, value: string, params?: Params): Promise<unknown>;
  list(params?: Params): Promise<unknown>;
  all(params?: Params): Promise<unknown>;
}
interface LooseClient {
  model(label: string): LooseModel;
  singleton(label: string): { retrieve(params?: Params): Promise<unknown> };
}

/**
 * Content helpers for the starter content model: pages by path, posts,
 * taxonomies, menus, site settings and redirects. Missing objects are `null`.
 */
// biome-ignore lint/suspicious/noExplicitAny: the client is typed per project
export function createContent(client: DjangoRestClient<any>, labels: Partial<ContentLabels> = {}) {
  const api = client as unknown as LooseClient;
  const l: ContentLabels = { ...DEFAULT_LABELS, ...labels };

  return {
    /**
     * A published page by its path, such as `about/team`, with media expanded.
     * A filter rather than a lookup route, because paths contain slashes.
     */
    async getPage(path: string): Promise<Page | null> {
      const clean = path.replace(/^\/+|\/+$/g, "");
      const result = (await api.model(l.page).list({
        filters: { path: clean },
        expand: ["share_image"],
        limit: 1,
      })) as Paginated<Page>;
      return result.data[0] ?? null;
    },

    /** The page shown at `/`, from the site settings, or `null`. */
    async getHomePage(settings?: SiteSettings | null): Promise<Page | null> {
      const site = settings === undefined ? await this.getSiteSettings() : settings;
      if (!site?.home_page) return null;
      return orNull(api.model(l.page).retrieve(site.home_page, { expand: ["share_image"] }) as Promise<Page>);
    },

    /** Every published page, for sitemaps. */
    getAllPages(): Promise<Page[]> {
      return api.model(l.page).all({ fields: ["id", "path", "title", "published_at"] }) as Promise<Page[]>;
    },

    /** A page of published posts, newest first, with covers, authors and taxonomies expanded. */
    getPosts(options: GetPostsOptions = {}): Promise<Paginated<Post>> {
      const filters: Record<string, string> = {};
      if (options.category) filters.categories__slug = options.category;
      if (options.tag) filters.tags__slug = options.tag;
      if (options.author) filters.author__slug = options.author;
      return api.model(l.post).list({
        filters,
        ordering: ["-published_at"],
        expand: ["cover", "author", "categories", "tags"],
        omit: ["body"],
        page: options.page ?? 1,
        limit: options.limit ?? 10,
        ...(options.search ? { search: options.search } : {}),
      }) as Promise<Paginated<Post>>;
    },

    /** Every published post, for sitemaps and feeds. */
    getAllPosts(): Promise<Post[]> {
      return api.model(l.post).all({ ordering: ["-published_at"], omit: ["body"] }) as Promise<Post[]>;
    },

    /** A published post by slug, with its cover, author and taxonomies. */
    getPost(slug: string): Promise<Post | null> {
      return orNull(
        api.model(l.post).retrieveBy("slug", slug, {
          expand: ["cover", "author", "author.avatar", "categories", "tags", "share_image"],
        }) as Promise<Post>,
      );
    },

    getCategory(slug: string): Promise<Taxonomy | null> {
      return orNull(api.model(l.category).retrieveBy("slug", slug) as Promise<Taxonomy>);
    },

    getTag(slug: string): Promise<Taxonomy | null> {
      return orNull(api.model(l.tag).retrieveBy("slug", slug) as Promise<Taxonomy>);
    },

    /** A menu by its slug, such as `main`. */
    getMenu(slug: string): Promise<Menu | null> {
      return orNull(api.model(l.menu).retrieveBy("slug", slug) as Promise<Menu>);
    },

    getSiteSettings(): Promise<SiteSettings | null> {
      return orNull(
        api.singleton(l.siteSettings).retrieve({ expand: ["logo", "share_image"] }) as Promise<SiteSettings>,
      );
    },

    /** The redirect for a path, such as `/old-page`, or `null`. */
    async resolveRedirect(path: string): Promise<Redirect | null> {
      const clean = `/${path.replace(/^\/+|\/+$/g, "")}`;
      const result = (await api
        .model(l.redirect)
        .list({ filters: { old_path: clean }, limit: 1 })) as Paginated<Redirect>;
      return result.data[0] ?? null;
    },
  };
}

export type Content = ReturnType<typeof createContent>;

/** The URL a menu link points to: its page's path, or its own URL. */
export function linkHref(item: { value: { page: { url?: string } | null; url: string } }): string {
  return item.value.page?.url ?? (item.value.url || "/");
}

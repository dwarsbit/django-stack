import { type SeoInput, type SiteSettings } from "@django-stack/utils";
interface Props {
    page?: SeoInput | null;
    settings: SiteSettings | null;
    /** The site's public URL, such as https://example.com. */
    siteUrl: string;
    /** The path of the page, for the canonical URL. */
    path: string;
    type?: "website" | "article";
}
declare const Seo: import("svelte").Component<Props, {}, "">;
type Seo = ReturnType<typeof Seo>;
export default Seo;

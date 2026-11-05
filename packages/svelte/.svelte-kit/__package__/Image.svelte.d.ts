import { type Media } from "@django-stack/utils";
interface Props {
    media: Media | string | null | undefined;
    /** An image size from IMAGE_SIZES, such as card or hero. */
    size?: string;
    /** The sizes attribute, for the browser to pick from the srcset. */
    sizes?: string;
    alt?: string;
    class?: string;
    eager?: boolean;
}
declare const Image: import("svelte").Component<Props, {}, "">;
type Image = ReturnType<typeof Image>;
export default Image;

import type { Block } from "@django-stack/utils";
import type { Component } from "svelte";
interface Props {
    blocks: Block[] | null | undefined;
    components?: Record<string, Component<{
        block: any;
    }>>;
}
declare const Blocks: Component<Props, {}, "">;
type Blocks = ReturnType<typeof Blocks>;
export default Blocks;

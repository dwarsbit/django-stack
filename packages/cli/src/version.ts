import { createRequire } from "node:module";

/** The version of this package, the same for every @django-stack package. */
export const CLI_VERSION: string = createRequire(import.meta.url)("../package.json").version;

/** The npm package of the CLI. */
export const PACKAGE_NAME = "@django-stack/cli";

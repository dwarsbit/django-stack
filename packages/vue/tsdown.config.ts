import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "neutral",
  deps: { neverBundle: ["vue", "@django-stack/utils"] },
  dts: true,
  clean: true,
  fixedExtension: false,
});

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: "esm",
  platform: "neutral",
  deps: { neverBundle: ["react", "react/jsx-runtime", "@django-stack/utils"] },
  dts: true,
  clean: true,
  fixedExtension: false,
});

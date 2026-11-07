import { CAPTCHA_CSP } from "@django-stack/utils";
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

// The Django backend: the frontend container reaches it on the Compose network.
const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
// Umami, for page analytics: only its tracker and page views, under /_a/.
const umami = process.env.UMAMI_URL || "http://umami:3000";

// SvelteKit takes keyword sources without quotes, such as self.
const unquoted = (sources: readonly string[]) =>
  sources.map((source) => source.replaceAll("'", "")) as never[];

export default defineConfig({
  plugins: [
    sveltekit({
      // A Node server: pages render on request, so a publish shows within seconds.
      adapter: adapter(),
      // A Content-Security-Policy on every page: scripts and styles only from
      // this site, with hashes for the ones SvelteKit inlines (hashes, not
      // nonces, so cached pages stay valid). src/hooks.server.ts adds the
      // origin of the media files. CAPTCHA_CSP allows the captcha widget of
      // the contact form: its solver, its style and its workers.
      csp: {
        mode: "hash",
        directives: {
          "default-src": ["self"],
          "script-src": ["self", ...unquoted(CAPTCHA_CSP["script-src"])],
          "style-src": ["self", ...unquoted(CAPTCHA_CSP["style-src"])],
          "worker-src": unquoted(CAPTCHA_CSP["worker-src"]),
          // Inline style attributes, such as the focal point of an image.
          "style-src-attr": ["unsafe-inline"],
          "base-uri": ["self"],
          "form-action": ["self"],
          "object-src": ["none"],
        },
      },
    }),
  ],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    // Django calls /revalidate at http://frontend:3000 on the Compose network.
    allowedHosts: ["frontend"],
    // In development, serve Django's paths from the same origin as the site,
    // like the reverse proxy does in production.
    proxy: {
      ...Object.fromEntries(
        ["/admin", "/api", "/media", "/static"].map((path) => [
          path,
          { target: backend, changeOrigin: false },
        ]),
      ),
      "^/_a/(script\\.js|api/send)$": { target: umami, rewrite: (path) => path.slice("/_a".length) },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

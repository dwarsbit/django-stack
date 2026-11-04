// @ts-check
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// The Django backend: the frontend container reaches it on the Compose network.
const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

export default defineConfig({
  site: process.env.SITE_URL ?? "http://localhost:3000",
  // Server output: pages render on request, so a publish shows within seconds.
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: true, port: 3000 },
  // A Content-Security-Policy on every page: scripts and styles only from
  // this site, with hashes for the ones Astro inlines. src/middleware.ts adds
  // the origin of the media files.
  security: {
    csp: {
      directives: ["default-src 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"],
      // Inline style attributes, such as the focal point of an image.
      styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: "attribute" }] },
    },
  },
  vite: {
    server: {
      // Django calls /revalidate at http://frontend:3000 on the Compose network.
      allowedHosts: ["frontend"],
      // In development, serve Django's paths from the same origin as the site,
      // like the reverse proxy does in production.
      proxy: Object.fromEntries(
        ["/admin", "/api", "/media", "/static"].map((path) => [
          path,
          { target: backend, changeOrigin: false },
        ]),
      ),
    },
  },
});

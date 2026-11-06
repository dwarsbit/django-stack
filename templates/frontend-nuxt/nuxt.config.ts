// The Django backend: the frontend container reaches it on the Compose network.
const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
// Umami, for page analytics: only its tracker and page views, under /_a/.
const umami = process.env.UMAMI_URL || "http://umami:3000";

export default defineNuxtConfig({
  compatibilityDate: "2026-11-01",
  srcDir: "src/",
  modules: ["nuxt-security"],
  css: ["~/assets/main.css"],
  telemetry: false,
  devtools: { enabled: false },
  app: {
    head: {
      htmlAttrs: { lang: "en" },
      link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    },
  },
  devServer: { host: "0.0.0.0", port: 3000 },
  vite: {
    // Django calls /revalidate at http://frontend:3000 on the Compose network.
    server: { allowedHosts: ["frontend"] },
  },
  nitro: {
    // A Node server: pages render on request, so a publish shows within seconds.
    preset: "node-server",
  },
  // In development, serve Django's paths from the same origin as the site,
  // like the reverse proxy does in production.
  $development: {
    routeRules: {
      ...Object.fromEntries(
        ["/admin", "/api", "/media", "/static"].map((path) => [
          `${path}/**`,
          { proxy: `${backend}${path}/**` },
        ]),
      ),
      "/_a/script.js": { proxy: `${umami}/script.js` },
      "/_a/api/send": { proxy: `${umami}/api/send` },
    },
  },
  // Security headers, with a Content-Security-Policy on every page in
  // production: scripts and styles only from this site, with a nonce for
  // the ones Nuxt inlines. server/plugins/media-origins.ts adds the origin
  // of the media files.
  security: {
    nonce: true,
    rateLimiter: false,
    xssValidator: false,
    headers: {
      contentSecurityPolicy:
        process.env.NODE_ENV === "production"
          ? {
              "default-src": ["'self'"],
              "script-src": ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
              "style-src": ["'self'", "'nonce-{{nonce}}'"],
              // Inline style attributes, such as the focal point of an image.
              "style-src-attr": ["'unsafe-inline'"],
              "img-src": ["'self'", "data:"],
              "media-src": ["'self'"],
              "font-src": ["'self'"],
              "connect-src": ["'self'"],
              "base-uri": ["'self'"],
              "form-action": ["'self'"],
              "frame-ancestors": ["'none'"],
              "object-src": ["'none'"],
              "upgrade-insecure-requests": false,
            }
          : false,
      // Media may come from another origin (S3 or a CDN) without CORP headers.
      crossOriginEmbedderPolicy: false,
      permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
    },
  },
});

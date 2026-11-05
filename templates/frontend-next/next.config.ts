import type { NextConfig } from "next";

const config: NextConfig = {
  // A self-contained server in .next/standalone, for a small production image.
  output: "standalone",
  // Django's paths end in a slash; the dev proxy in src/proxy.ts passes them on as they are.
  skipTrailingSlashRedirect: true,
  // Django calls /revalidate at http://frontend:3000 on the Compose network.
  allowedDevOrigins: ["frontend"],
  poweredByHeader: false,
  experimental: {
    // The data cache stays in memory: the production container's file system is read-only.
    isrFlushToDisk: false,
    // Media uploads in the admin pass through the dev proxy.
    proxyClientMaxBodySize: "100mb",
  },
};

export default config;

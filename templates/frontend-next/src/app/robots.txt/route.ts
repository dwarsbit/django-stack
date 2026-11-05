import { connection } from "next/server";
import { SITE_URL } from "@/lib/api";

export async function GET() {
  // Rendered on request: SITE_URL is set when the container starts.
  await connection();
  return new Response(
    `User-agent: *\nDisallow: /admin/\nDisallow: /preview\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}

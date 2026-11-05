import "./globals.css";
import { Image, RichText } from "@django-stack/react";
import { linkHref } from "@django-stack/utils";
import type { Metadata } from "next";
import { NavLink } from "@/components/NavLink";
import { getContent, previewToken, SITE_URL } from "@/lib/api";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const content = await getContent();
  const [settings, mainMenu, footerMenu, preview] = await Promise.all([
    content.getSiteSettings(),
    content.getMenu("main"),
    content.getMenu("footer"),
    previewToken(),
  ]);
  return (
    <html lang="en">
      <body>
        {preview !== null ? (
          <div className="preview-banner">
            Preview: drafts are shown. <a href="/preview/exit">Leave preview</a>
          </div>
        ) : null}
        <header className="site-header">
          <div className="container bar">
            <a className="brand" href="/">
              {settings?.logo ? (
                <Image media={settings.logo} size="thumbnail" alt={settings.site_name} eager />
              ) : (
                settings?.site_name
              )}
            </a>
            <nav aria-label="Main">
              {(mainMenu?.items ?? []).map((item) => (
                <NavLink key={item.id} href={linkHref(item)}>
                  {item.value.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container bar muted">
            <RichText html={settings?.footer_text} className="footer-text" />
            <nav aria-label="Footer">
              {(footerMenu?.items ?? []).map((item) => (
                <a key={item.id} href={linkHref(item)}>
                  {item.value.label}
                </a>
              ))}
              {Object.entries(settings?.social_links ?? {}).map(([name, url]) => (
                <a key={name} href={url} rel="me">
                  {name}
                </a>
              ))}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}

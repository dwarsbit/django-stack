import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";
import ThemedImage from "@theme/ThemedImage";
import { useEffect, useState } from "react";

const heroCode = `npm install --global @django-stack/cli
dstack init my-site
cd my-site
dstack dev`;

const frontends = ["Astro", "Next.js", "SvelteKit", "Django templates", "None (headless, API only)"];

// The frontend row of the hero shows each frontend option in turn. It stays
// on the first one for visitors who ask for reduced motion.
function RotatingFrontend() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = setInterval(() => setIndex((current) => (current + 1) % frontends.length), 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="hero-rotate" aria-live="off">
      <span className="hero-rotate-item" key={frontends[index]}>
        {frontends[index]}
      </span>
    </span>
  );
}

const services = [
  { name: "frontend", text: <RotatingFrontend />, note: "localhost:3000" },
  { name: "admin", text: "Django Content Studio", note: "/admin/" },
  { name: "api", text: "Django Headless", note: "/api/" },
  { name: "db", text: "Postgres", note: "" },
  { name: "cache", text: "Valkey", note: "" },
  { name: "mail", text: "Mailpit", note: "localhost:8025" },
  { name: "analytics", text: "Umami", note: "" },
];

// Logos are shown in one color; `width` and `height` keep each one's aspect
// ratio. Wordmarks carry their own name, marks get it as text.
const logoGroups = [
  {
    title: "Built with",
    logos: [
      { name: "Django", file: "django.svg", width: 87, height: 30, wordmark: true },
      { name: "Docker", file: "docker.svg", width: 30, height: 30 },
      { name: "Valkey", file: "valkey.svg", width: 26, height: 30 },
      { name: "Umami", file: "umami.svg", width: 29, height: 26 },
    ],
  },
  {
    title: "Frontends",
    logos: [
      { name: "Astro", file: "astro.svg", width: 111, height: 30, wordmark: true },
      { name: "Next.js", file: "next.svg", width: 99, height: 20, wordmark: true },
      { name: "SvelteKit", file: "svelte.svg", width: 26, height: 26 },
    ],
  },
  {
    title: "Deploy to",
    logos: [{ name: "Coolify", file: "coolify.svg", width: 26, height: 26 }],
  },
];

const features = [
  {
    title: "One command",
    text: "The init command asks for the frontend, the database and demo content, and writes a project with fresh secrets. Every prompt has a flag, so it also runs in scripts.",
  },
  {
    title: "Your content model",
    text: "Pages, posts, menus and site settings as ordinary Django models in your project. Change them like any other model.",
  },
  {
    title: "An admin for editors",
    text: "Django Content Studio manages the content, with drafts, a media library and a preview of a draft on the site.",
  },
  {
    title: "Closed by default",
    text: "The API needs a key for every request, and the frontend gets the read-only key only, on the server.",
  },
  {
    title: "Production on your server",
    text: "The same compose.yaml runs behind Caddy with HTTPS, read-only containers without privileges and daily backups. dstack deploy puts it on Coolify.",
  },
  {
    title: "Open pieces",
    text: "Django, Django Headless, Django Content Studio, Astro, Postgres, Valkey and Umami: every piece is an open-source project you can read, change or remove.",
  },
];

function Logo({ logo }) {
  const url = useBaseUrl(`/img/logos/${logo.file}`);
  return (
    <li className="logo-item">
      <span
        className="logo-mark"
        role="img"
        aria-label={logo.name}
        style={{
          width: logo.width,
          height: logo.height,
          maskImage: `url(${url})`,
          WebkitMaskImage: `url(${url})`,
        }}
      />
      {logo.wordmark ? null : <span className="logo-name">{logo.name}</span>}
    </li>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout title="Developer-first Django tooling" description={siteConfig.tagline}>
      <header className="hero-dst">
        <div className="container">
          <div>
            <h1>Developer-first Django tooling</h1>
            <p className="tagline">{siteConfig.tagline}</p>
            <p className="hero-intro">
              DjangoStack creates a website project with a Django backend, an Astro frontend, Postgres, Valkey
              and Umami analytics, run by Docker Compose. Django Headless serves the content API and Django
              Content Studio is the admin.
            </p>
            <div className="buttons">
              <Link className="button button--lg button-dst-primary" to="/docs/getting-started">
                Get started
              </Link>
              <Link
                className="button button--lg button-dst-secondary"
                href="https://github.com/dwarsbit/django-stack"
              >
                GitHub
              </Link>
            </div>
          </div>
          <div className="hero-visual">
            <CodeBlock language="bash">{heroCode}</CodeBlock>
            <div className="hero-services">
              {services.map((service) => (
                <div className="hero-service" key={service.name}>
                  <span className="name">{service.name}</span>
                  <span>{service.text}</span>
                  <span className="note">{service.note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>
      <section className="logos-dst">
        <div className="container logos-grid">
          {logoGroups.map((group) => (
            <div className="logos-group" key={group.title}>
              <p className="logos-title">{group.title}</p>
              <ul className="logos-row">
                {group.logos.map((logo) => (
                  <Logo logo={logo} key={logo.name} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
      <main>
        <section className="admin-dst">
          <div className="container">
            <h2 className="section-title">The admin</h2>
            <p className="section-intro">
              Editors write pages and posts, upload media and preview drafts in{" "}
              <Link href="https://djangocontentstudio.org">Django Content Studio</Link>.
            </p>
            <figure className="screenshot">
              <ThemedImage
                alt="The dashboard of Django Content Studio, with statistics, the latest articles, notifications and recent activity"
                sources={{
                  light: useBaseUrl("/img/screenshots/dashboard-light.webp"),
                  dark: useBaseUrl("/img/screenshots/dashboard-dark.webp"),
                }}
                width={1568}
                height={1080}
                loading="lazy"
                decoding="async"
              />
            </figure>
          </div>
        </section>
        <section className="features-dst">
          <div className="container">
            <h2 className="section-title">What a project includes</h2>
            <div className="features-grid">
              {features.map((feature) => (
                <div className="feature-card" key={feature.title}>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

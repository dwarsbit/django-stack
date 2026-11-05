import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";

const heroCode = `npx @django-stack/cli init my-site
cd my-site
docker compose up`;

const services = [
  { name: "frontend", text: "Astro", note: "localhost:3000" },
  { name: "admin", text: "Django Content Studio", note: "/admin/" },
  { name: "api", text: "Django Headless", note: "/api/" },
  { name: "db", text: "Postgres", note: "" },
  { name: "cache", text: "Valkey", note: "" },
  { name: "mail", text: "Mailpit", note: "localhost:8025" },
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
    text: "The same compose.yaml runs behind Caddy with HTTPS, read-only containers without privileges and daily backups.",
  },
  {
    title: "Open pieces",
    text: "Django, Django Headless, Django Content Studio, Astro and Postgres: every piece is an open-source project you can read, change or remove.",
  },
];

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
              DjangoStack creates a website project with a Django backend, an Astro frontend, Postgres and
              Docker Compose. Django Headless serves the content API and Django Content Studio is the admin.
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
      <main>
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

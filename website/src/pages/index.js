import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

export default function Home() {
  return (
    <Layout
      title="DjangoStack"
      description="Django, a frontend of your choice, Postgres and Docker Compose, ready in one command"
    >
      <main className="container margin-vert--xl">
        <h1>DjangoStack</h1>
        <p>
          One command creates a project with a Django backend, an Astro or Next.js frontend, Postgres and
          Docker Compose. Django Headless serves the content API and Django Content Studio is the admin.
        </p>
        <pre>
          <code>npx @django-stack/cli init my-site</code>
        </pre>
        <Link className="button button--primary" to="/docs/intro">
          Read the docs
        </Link>
      </main>
    </Layout>
  );
}

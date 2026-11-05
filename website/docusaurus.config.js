// @ts-check
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "DjangoStack",
  tagline: "Django, a frontend of your choice, Postgres and Docker Compose, ready in one command",
  favicon: "img/favicon.svg",
  // GitHub Pages at its default address until the site has its own domain.
  // With a domain: set url to it, baseUrl to "/" and add static/CNAME.
  url: "https://dwarsbit.github.io",
  baseUrl: "/django-stack/",
  organizationName: "dwarsbit",
  projectName: "django-stack",
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  trailingSlash: false,
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: "light",
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: "DjangoStack",
        logo: { alt: "DjangoStack", src: "img/logo.svg" },
        items: [
          { label: "Docs", position: "left", to: "docs/intro" },
          { href: "https://djangoheadless.org", label: "Django Headless", position: "right" },
          { href: "https://djangocontentstudio.org", label: "Django Content Studio", position: "right" },
          { href: "https://github.com/dwarsbit/django-stack", label: "GitHub", position: "right" },
          { href: "https://www.npmjs.com/package/@django-stack/cli", label: "npm", position: "right" },
        ],
      },
      footer: {
        style: "dark",
        copyright: `Copyright © ${new Date().getFullYear()} Leon van der Grient. Built with Django and Docusaurus.`,
        links: [
          {
            title: "Docs",
            items: [
              { label: "Introduction", to: "/docs/intro" },
              { label: "Getting started", to: "/docs/getting-started" },
              { label: "CLI reference", to: "/docs/cli" },
              { label: "Deploy to a server", to: "/docs/production/server" },
            ],
          },
          {
            title: "Project",
            items: [
              { label: "GitHub", href: "https://github.com/dwarsbit/django-stack" },
              { label: "npm", href: "https://www.npmjs.com/package/@django-stack/cli" },
              { label: "PyPI", href: "https://pypi.org/project/django-stack/" },
            ],
          },
          {
            title: "Related",
            items: [
              { label: "Django Headless", href: "https://djangoheadless.org" },
              { label: "Django Content Studio", href: "https://djangocontentstudio.org" },
            ],
          },
        ],
      },
      prism: {
        additionalLanguages: ["bash", "json", "python", "yaml", "docker"],
      },
    }),
  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve("./sidebars.js"),
          editUrl: "https://github.com/dwarsbit/django-stack/edit/main/website/",
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      }),
    ],
  ],
};

module.exports = config;

// @ts-check
// Every package shares one version (see CHANGELOG.md); the CLI's is the one
// on npm. The Release workflow redeploys the docs after a release.
const { version } = require("../packages/cli/package.json");
const releaseUrl = `https://github.com/dwarsbit/django-stack/releases/tag/v${version}`;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "DjangoStack",
  tagline: "The production-ready Django, batteries included stack.",
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
  customFields: { version, releaseUrl },
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
          {
            type: "html",
            position: "left",
            value: `<a class="dst-version" href="${releaseUrl}" title="Release notes for v${version}">v${version}</a>`,
          },
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

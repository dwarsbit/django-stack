// @ts-check
/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "DjangoStack",
  tagline: "Django, a frontend of your choice, Postgres and Docker Compose, ready in one command",
  favicon: "img/favicon.svg",
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
        logo: { alt: "DjangoStack", src: "img/favicon.svg" },
        items: [
          { label: "Docs", position: "left", to: "docs/intro" },
          { href: "https://djangoheadless.org", label: "Django Headless", position: "right" },
          { href: "https://djangocontentstudio.org", label: "Django Content Studio", position: "right" },
          { href: "https://github.com/dwarsbit/django-stack", label: "GitHub", position: "right" },
        ],
      },
      footer: {
        style: "dark",
        copyright: `Copyright © ${new Date().getFullYear()} Leon van der Grient. Built with Docusaurus.`,
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

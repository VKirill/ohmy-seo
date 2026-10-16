# ohmy-seo

ohmy-seo is a monorepo of Model Context Protocol (MCP) servers that let AI clients work with SEO, analytics, advertising, and reporting APIs. It includes local stdio servers and a hosted web account cabinet with a Streamable HTTP MCP gateway.

## What it does

- Connects to Yandex Direct, Metrika, Webmaster, Google Search Console, GA4, Tag Manager, Google Ads, Mutagen, XMLStock, and Roistat.
- Lets MCP clients read account data and perform supported changes through package tools and the hosted gateway's policy gates.
- Provides a web cabinet for OAuth account connections and hosted MCP API keys.

## Quick start

Requirements: Node.js 22 or newer and pnpm.

```sh
git clone https://github.com/VKirill/ohmy-seo.git
cd ohmy-seo
pnpm install
pnpm -r build
```

Configure the relevant package environment variables from its `.env.example`, then connect the package's `dist/index.js` to an MCP client. Package-specific setup is documented in each workspace README.

## Documentation

- [System overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Packages](docs/packages.md)
- [Deployment](docs/deployment.md)
- [Cross-cutting gotchas](docs/gotchas.md)
- [Data model map](docs/data-model.md)
- [Hosted stack operations](hosting/OPERATIONS.md)
- [Yandex MCP agent skill](skills/ohmy-seo-mcp/SKILL.md)

MIT licensed. See [LICENSE](LICENSE).

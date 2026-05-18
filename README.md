# ohmy-seo

Monorepo of MCP servers for SEO analytics — Yandex, Google, and third-party SERP tools.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| `@ohmy-seo/mcp-core` | 0.3.0 | Shared infra: OAuth storage, caching, base types |
| `@ohmy-seo/yandex-seo` | 0.7.0 | Yandex Metrika, Webmaster, Direct |
| `@ohmy-seo/mutagen` | 0.1.0 | Keyword competition scoring via Mutagen.ru |
| `@ohmy-seo/xmlstock` | 0.2.0 | SERP data via XMLStock API |
| `@ohmy-seo/google-search-console` | 0.1.0 | Google Search Console + Indexing API |
| `@ohmy-seo/ga4` | 0.1.0 | GA4 Data API + Admin API |
| `@ohmy-seo/gtm` | 0.1.0 | Google Tag Manager (read, write, publish, rollback) |

## Setup

```bash
pnpm install && pnpm -r build
```

Requires Node.js >= 22 and pnpm.

## MCP Servers

Six MCP servers are registered in `~/.claude.json`:

| Server | Package | Tools |
|--------|---------|-------|
| `mcp-yandex-seo` | `@ohmy-seo/yandex-seo` | 19 |
| `mcp-mutagen` | `@ohmy-seo/mutagen` | 2 |
| `mcp-xmlstock` | `@ohmy-seo/xmlstock` | 3 |
| `mcp-gsc` | `@ohmy-seo/google-search-console` | 16 |
| `mcp-ga4` | `@ohmy-seo/ga4` | 17 |
| `mcp-gtm` | `@ohmy-seo/gtm` | 26 |

Each server is launched as a stdio process pointing to the built `dist/index.js` of its package.

## OAuth Setup

Google packages (mcp-gsc, mcp-ga4, mcp-gtm) require Google OAuth or a Service Account.
Full setup instructions: `~/.claude/skills/google-cloud-auth/SKILL.md`

### User OAuth flow

1. `register_google_oauth_app` — register your OAuth client ID + secret
2. `start_google_oauth_flow` — get the consent URL, complete it in the browser, then call `complete_google_oauth_flow` with the returned code

### Service Account flow

1. `register_service_account` with `json_path` pointing to your downloaded service account JSON key file

Yandex OAuth (mcp-yandex-seo) uses its own flow: `register_oauth_app` → `start_oauth_flow` → `complete_oauth_flow`.

## Environment Variables

- `MUTAGEN_API_KEY` — required for mcp-mutagen and mcp-yandex-seo Mutagen tools
- `XMLSTOCK_USER` + `XMLSTOCK_KEY` — required for mcp-xmlstock live calls

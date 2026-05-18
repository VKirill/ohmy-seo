# @ohmy-seo/google-search-console v0.1.0

MCP server for Claude Code providing 17 tools for Google Search Console: search
analytics, URL inspection, sitemap management, indexing API, and OAuth account
management. Secrets are encrypted in a local SQLite database using AES-256-GCM.
Results are cached locally to minimise API quota usage.

## Install

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_GSC_MASTER_KEY` | yes | — | 32 hex bytes for AES-256-GCM encryption. Generate: `openssl rand -hex 32` |
| `MCP_GSC_DB_PATH` | no | `./data/state.db` | Path to the local SQLite state database |
| `MCP_GSC_CACHE_TTL_SEARCH` | no | `3600` | Cache TTL for search analytics results (seconds) |
| `MCP_GSC_CACHE_TTL_META` | no | `86400` | Cache TTL for site/sitemap listings (seconds) |
| `MCP_GSC_CACHE_TTL_INSPECT` | no | `3600` | Cache TTL for URL inspection results (seconds) |
| `MCP_GSC_OAUTH_LOOPBACK_PORT` | no | `8765` | Port for OAuth loopback redirect |

## Tools

### Search & Inspection

- `gsc_list_sites` — list all Search Console properties (24h cache)
- `gsc_search_analytics` — query performance data: queries, pages, countries, devices (1h cache)
- `gsc_url_inspection` — inspect a URL's index status and coverage (1h cache)

### Sitemaps

- `gsc_list_sitemaps` — list submitted sitemaps for a site (24h cache)
- `gsc_submit_sitemap` — submit a new sitemap URL (uncached, write)
- `gsc_delete_sitemap` — delete a submitted sitemap (uncached, write)

### Indexing API

- `gsc_indexing_publish` — request indexing for a URL (JobPosting / BroadcastEvent only)

### OAuth / Account management (8 tools)

- `register_google_oauth_app` — register OAuth client credentials
- `list_google_oauth_apps` — list registered OAuth apps
- `delete_google_oauth_app` — remove an OAuth app
- `list_google_accounts` — list connected Google accounts
- `start_google_oauth_flow` — begin browser OAuth flow, returns auth URL
- `complete_google_oauth_flow` — complete flow with auth code
- `delete_google_account` — remove a connected account
- `set_default_google_account` — set default account for all tools

### Cache

- `gsc_invalidate_cache` — invalidate cached responses
- `gsc_cache_stats` — show cache hit/miss statistics

## OAuth setup

Follow the quickstart in `~/.claude/skills/google-cloud-auth/SKILL.md`.

**Short version (User OAuth):**
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID
2. Enable: Search Console API, Indexing API
3. `register_google_oauth_app({label, client_id, client_secret, scopes_declared, redirect_uri})`
4. `start_google_oauth_flow({app_label, account_label})` → open URL in browser
5. Grant access → loopback callback completes automatically (port 8765)
6. `set_default_google_account({label})`

## Build

```bash
pnpm run build
```

Output is written to `./dist/`. The entry point `./dist/index.js` is the MCP
server binary registered as `mcp-gsc`.

## Connect to Claude Code

```bash
pnpm run build
export MCP_GSC_MASTER_KEY=$(openssl rand -hex 32)
claude mcp add mcp-gsc node /path/to/packages/google-search-console/dist/index.js \
  -e MCP_GSC_MASTER_KEY=$MCP_GSC_MASTER_KEY
```

## Smoke test

```bash
pnpm run build
export MCP_GSC_MASTER_KEY=$(openssl rand -hex 32)
pnpm run smoke
```

## Security

- OAuth tokens are encrypted with AES-256-GCM; master key lives only in env.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- The master key is never logged or included in tool responses.

## License

MIT

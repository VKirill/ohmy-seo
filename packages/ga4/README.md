# @ohmy-seo/ga4 v0.1.0

MCP server for Claude Code providing 18 tools for Google Analytics 4: report
queries (standard, batch, pivot, realtime), property metadata, custom dimensions,
conversion events, and OAuth account management. Secrets are encrypted in a local
SQLite database using AES-256-GCM. Results are cached locally to minimise API
quota usage. Realtime reports are never cached by design.

## Install

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_GA4_MASTER_KEY` | yes | — | 32 hex bytes for AES-256-GCM encryption. Generate: `openssl rand -hex 32` |
| `MCP_GA4_DB_PATH` | no | `./data/state.db` | Path to the local SQLite state database |
| `MCP_GA4_CACHE_TTL_REPORT` | no | `3600` | Cache TTL for report results (seconds) |
| `MCP_GA4_CACHE_TTL_META` | no | `86400` | Cache TTL for property/dimension/metric listings (seconds) |
| `MCP_GA4_OAUTH_LOOPBACK_PORT` | no | `8766` | Port for OAuth loopback redirect |

## Tools

### Reports

- `ga4_run_report` — run a standard Analytics report with dimensions and metrics (1h cache)
- `ga4_run_realtime_report` — run a realtime report (never cached)
- `ga4_batch_run_reports` — run up to 5 reports in a single API call (1h cache)
- `ga4_run_pivot_report` — run a pivot report (1h cache)

### Metadata & Admin

- `ga4_list_properties` — list accessible GA4 properties (24h cache)
- `ga4_get_metadata` — get available dimensions and metrics for a property (24h cache)
- `ga4_list_custom_dimensions` — list custom dimensions for a property (24h cache)
- `ga4_list_conversion_events` — list conversion events for a property (24h cache)

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

- `ga4_invalidate_cache` — invalidate cached responses
- `ga4_cache_stats` — show cache hit/miss statistics

## OAuth setup

Follow the quickstart in `~/.claude/skills/google-cloud-auth/SKILL.md`.

**Short version (User OAuth):**
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID
2. Enable: Google Analytics Data API, Google Analytics Admin API
3. `register_google_oauth_app({label, client_id, client_secret, scopes_declared, redirect_uri})`
4. `start_google_oauth_flow({app_label, account_label})` → open URL in browser
5. Grant access → loopback callback completes automatically (port 8766)
6. `set_default_google_account({label})`

## Build

```bash
pnpm run build
```

Output is written to `./dist/`. The entry point `./dist/index.js` is the MCP
server binary registered as `mcp-ga4`.

## Connect to Claude Code

```bash
pnpm run build
export MCP_GA4_MASTER_KEY=$(openssl rand -hex 32)
claude mcp add mcp-ga4 node /path/to/packages/ga4/dist/index.js \
  -e MCP_GA4_MASTER_KEY=$MCP_GA4_MASTER_KEY
```

## Smoke test

```bash
pnpm run build
export MCP_GA4_MASTER_KEY=$(openssl rand -hex 32)
pnpm run smoke
```

## Security

- OAuth tokens are encrypted with AES-256-GCM; master key lives only in env.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- The master key is never logged or included in tool responses.

## License

MIT

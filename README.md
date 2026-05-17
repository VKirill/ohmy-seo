# mcp-yandex-seo v0.3.0

MCP server for Claude Code providing 19 tools for Russian-language SEO via Yandex Webmaster,
Metrika, Wordstat (Direct), and Mutagen. v0.2 adds multi-account OAuth management: you register
one or more OAuth apps, connect Yandex accounts via Authorization Code flow, and all domain tools
resolve the right token automatically. Secrets are encrypted in a local SQLite database using
AES-256-GCM. v0.3 adds an inventory cache (list_sites, list_counters, find_property,
refresh_inventory) with 24h stale-while-revalidate TTL and a `site` shorthand for all domain
tools.

## Prerequisites

- Node.js 22+
- `openssl` (comes with Linux/macOS; on Windows use Git Bash or WSL)
- C++ toolchain for `better-sqlite3` native build: `gcc`/`g++` + `python3` + `make`  
  (on Ubuntu: `sudo apt install build-essential python3`)

## Install

```bash
cd /home/ubuntu/tools/mcp-yandex-seo
npm install
```

## Set master key

```bash
export MCP_YANDEX_SEO_MASTER_KEY=$(openssl rand -hex 32)
# Save this securely — losing it means losing all stored tokens
```

The server fails fast with a clear error if this key is missing or malformed.

## Build and connect to Claude Code

```bash
npm run build
claude mcp add mcp-yandex-seo node /home/ubuntu/tools/mcp-yandex-seo/dist/index.js -e MCP_YANDEX_SEO_MASTER_KEY=$MCP_YANDEX_SEO_MASTER_KEY
```

## Register your first OAuth app

1. Go to https://oauth.yandex.ru/client/new, create an app, set redirect URI:
   `https://oauth.yandex.ru/verification_code`
2. Select scopes: Yandex Webmaster → read, Yandex Metrika → statistics, Yandex Direct → API access
3. Copy `client_id` and `client_secret`
4. In Claude chat:

```
register_oauth_app({
  label: "main",
  client_id: "<your client_id>",
  client_secret: "<your client_secret>",
  scopes_declared: "webmaster:hostinfo metrika:read direct:api"
})
```

## Connect a Yandex account

```
start_oauth_flow({ app_label: "main", account_label: "kirill" })
```

Open the returned URL in your browser, approve the app, copy the 7-character code.

```
complete_oauth_flow({ account_label: "kirill", code: "<7-char code>" })
```

The account is now stored, tokens are encrypted. Refresh happens automatically when the token
nears expiry.

## Use any domain tool

```
webmaster_top_queries({
  account: "kirill",
  host_id: "https:treba.pro:443",
  date_from: "2026-05-01",
  date_to: "2026-05-15"
})
```

You can omit `account` if only one account exists or one is marked as default.

## All 19 tools

### OAuth management (8 tools)

| Tool | What it does |
|---|---|
| `list_oauth_apps` | List registered OAuth apps (no secrets shown) |
| `register_oauth_app` | Register a new Yandex OAuth app with encrypted client_secret |
| `delete_oauth_app` | Delete an app (blocked if accounts are attached) |
| `list_accounts` | List connected accounts with scope and expiry info |
| `start_oauth_flow` | Build the Yandex authorize URL for a given app + account label |
| `complete_oauth_flow` | Exchange 7-char OOB code for tokens, save encrypted |
| `delete_account` | Remove an account from the local database |
| `set_default_account` | Mark one account as default for tools that resolve automatically |

### Domain tools (7 tools)

| Tool | What it does |
|---|---|
| `webmaster_site_summary` | Host SQI, pages indexed, last crawl, issue count |
| `webmaster_top_queries` | Top queries: impressions/clicks/CTR/position for a date range |
| `webmaster_indexing_issues` | Diagnostic indexing problems for a host |
| `metrika_search_phrases` | Top organic search phrases with engagement metrics |
| `metrika_traffic_summary` | Traffic summary by source for a date range |
| `wordstat_keywords` | Keyword research via Direct Wordstat (frequencies + related) |
| `mutagen_competition` | Competition score 1–25 + CPC estimate for phrases |

All 7 domain tools accept an optional `account` parameter (account label).

## Inventory

The MCP keeps a local cache of all Webmaster sites and Metrika counters available to your
connected accounts. Cache TTL is 24 hours by default (configurable via
`MCP_YANDEX_SEO_CACHE_TTL_HOURS`). The behavior is **stale-while-revalidate**: if cached
data is older than the TTL, the call returns immediately with the stale rows and
triggers an async refresh in the background.

### Inventory tools

| Tool | What it does |
|---|---|
| `list_sites({account?})` | Webmaster hosts for one or all accounts (lazy refresh on cold cache) |
| `list_counters({account?})` | Metrika counters for one or all accounts |
| `find_property({query, kind?})` | Case-insensitive substring search; returns host_id/counter_id + account |
| `refresh_inventory({account?, kind?})` | Force refresh; without args refreshes all accounts × kinds |

### Using `site` instead of `host_id` / `counter_id`

All five domain tools (`webmaster_*`, `metrika_*`) accept an optional `site` parameter as an
alternative to `host_id` / `counter_id`. Example:

```
webmaster_top_queries({site: "treba.pro", date_from: "2026-05-01", date_to: "2026-05-15"})
```

The MCP resolves the site name via property-resolver. If the substring matches multiple
candidates with equal score, the tool returns an `AmbiguousSiteError` with the candidate
list — pass `account` filter or use direct `host_id` to disambiguate.

## Troubleshooting

**MASTER_KEY missing → server won't start**  
Generate: `openssl rand -hex 32`, then export as `MCP_YANDEX_SEO_MASTER_KEY`.

**Refresh failed → token revoked by user**  
Re-run `start_oauth_flow` + `complete_oauth_flow` with the same `account_label` to reconnect.

**"No matching account for scope X"**  
Register an OAuth app with that scope, then connect an account via `start_oauth_flow` +
`complete_oauth_flow`.

**Webmaster tools fail with "no webmaster_user_id"**  
The probe at `complete_oauth_flow` failed. Reconnect: `delete_account` → `start_oauth_flow` →
`complete_oauth_flow`.

## Migrating from v0.1

v0.2 is a **breaking change**. The following env vars are removed and no longer read:

| Removed in v0.2 | Was used for |
|---|---|
| `YANDEX_OAUTH_TOKEN` | Single OAuth token for all services |
| `WEBMASTER_USER_ID` | Yandex Webmaster user id |
| `METRIKA_COUNTER_ID` | Default Metrika counter id |
| `DIRECT_CLIENT_LOGIN` | Direct agency client login |

Replace these with the OAuth app + account flow described above.

## Security notes

- Tokens and `client_secret` are encrypted with AES-256-GCM; the master key lives only in env.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- The master key is never logged or included in tool responses.
- v0.5 will move master key storage to the OS keychain.

## Smoke test

```bash
npm run build
export MCP_YANDEX_SEO_MASTER_KEY=$(openssl rand -hex 32)
export SMOKE_OAUTH_CLIENT_ID=<your_client_id>
export SMOKE_OAUTH_CLIENT_SECRET=<your_client_secret>
export SMOKE_ACCESS_TOKEN=<your_access_token>   # skips browser flow
export SMOKE_TEST_HOST=https:treba.pro:443
export SMOKE_TEST_COUNTER=12345
npm run smoke
# For mutagen: SMOKE_MUTAGEN=1 npm run smoke -- --only=mutagen
```

Without `SMOKE_ACCESS_TOKEN` the runner prints the authorize URL and exits cleanly (code 0).

## Roadmap

See [docs/plans/mcp-yandex-seo/ROADMAP.md](docs/plans/mcp-yandex-seo/ROADMAP.md) for upcoming
versions:

- v0.3 — Inventory cache (list_sites, find_property, list_counters) ✓ done
- v0.4 — Query result cache with TTL (Wordstat/Mutagen)
- v0.5 — OS keychain for master key (keytar)

## License

MIT

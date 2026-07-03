# mcp-yandex-seo v0.6.0

MCP server for Claude Code providing 19 tools for Russian-language SEO via Yandex Webmaster,
Metrika, Direct, and Mutagen. Multi-account OAuth management: register one or more OAuth apps,
connect Yandex accounts via Authorization Code flow, and all domain tools resolve the right token
automatically. Secrets are encrypted in a local SQLite database using AES-256-GCM.

v0.5 replaces six narrow domain tools with three generic API gateways (`yandex_metrika_api`,
`yandex_webmaster_api`, `yandex_direct_api`) that accept any endpoint + method + params/body,
covering ~100% of each Yandex API instead of the former ~10%. See migration table below.

v0.6 adds `mutagen_api` — a generic gateway to the full Mutagen.ru API covering all 23 SERP
report types, keyword analytics, balance checks, and projects. See
`~/.claude/skills/mutagen/references/cookbook.md` for ready-to-run recipes.

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

## Use any API tool

```
yandex_webmaster_api({
  account: "kirill",
  endpoint: "/user/2/hosts/https:treba.pro:443/search-queries/all/history",
  params: { date_from: "2026-05-01", date_to: "2026-05-15" }
})
```

You can omit `account` if only one account exists or one is marked as default.

## All 20 tools

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

### Inventory (4 tools)

| Tool | What it does |
|---|---|
| `list_sites` | Webmaster hosts for one or all accounts (lazy refresh on cold cache) |
| `list_counters` | Metrika counters for one or all accounts |
| `find_property({query, kind?})` | Case-insensitive substring search; returns host_id/counter_id + account |
| `refresh_inventory({account?, kind?})` | Force refresh; without args refreshes all accounts × kinds |

Cache TTL is 24 hours by default (configurable via `MCP_YANDEX_SEO_CACHE_TTL_HOURS`).
The behavior is **stale-while-revalidate**: if cached data is older than the TTL, the call
returns immediately with the stale rows and triggers an async refresh in the background.

### Cache management (2 tools)

| Tool | What it does |
|---|---|
| `invalidate_cache({tool?, account?, older_than_hours?})` | Manual wipe with optional AND filters |
| `cache_stats({})` | total entries, DB size, top-10 tools by hits, 24h activity |

**force_refresh:** every cacheable tool accepts `force_refresh: true` to bypass cache read and
overwrite the entry. Use when upstream data is known to have changed.

### Yandex API (5 tools)

| Tool | What it does |
|---|---|
| `yandex_metrika_api` | Generic gateway to any Yandex Metrika endpoint (GET cached, POST/PUT/DELETE invalidate) |
| `yandex_webmaster_api` | Generic gateway to any Yandex Webmaster endpoint |
| `yandex_direct_api` | Generic gateway to any Yandex Direct v5 endpoint (Bearer auth + optional `client_login`) |
| `yandex_direct_account_balance` | Real-time balance (Amount) for a Yandex Direct client account via v4 Live API (v5 does not return Amount for shared accounts) |
| `mutagen_competition` | Keyword competition score 1–25 + CPC estimate for phrases via Mutagen |

**Usage example — `yandex_direct_account_balance`:**
```
yandex_direct_account_balance({ client_login: "porg-nqhs6wbe" })
```
Returns `{ login, account_id, amount, amount_available_for_transfer, currency, agency_name, email_notification, sms_notification, account_day_budget, raw }`.

All three generic tools accept `endpoint`, `method` (default GET), `params`, `body`,
`account`, and `force_refresh`. `yandex_direct_api` additionally accepts `client_login` for
agency sub-client access.

**GET responses are cached** with TTL `MCP_YANDEX_SEO_CACHE_TTL_API` (default 3600 s).
POST/PUT/DELETE bypass the cache and automatically invalidate related GET entries.

**Endpoint catalog:** full lists of endpoints, parameters, and usage examples live in skill
files on this machine:
- `~/.claude/skills/yandex-metrica/` — Yandex Metrika API (cookbook.md)
- `~/.claude/skills/yandex-webmaster/` — Yandex Webmaster API (cookbook.md)
- `~/.claude/skills/yandex-direct/` — Yandex Direct API v5 (cookbook.md, Reports lifecycle)

### Mutagen API (1 tool)

| Tool | What it does |
|---|---|
| `mutagen_api` | Generic gateway to the full Mutagen.ru API: all 23 SERP report types, keyword analytics, balance, projects. Handles async polling automatically. |

`mutagen_api` accepts `method` (e.g. `'balance'`, `'serp.report'`, `'check_key'`), `params`
(method-specific key-value object), `poll_timeout_sec` (default 60), and `force_refresh`.

**Subscription note:** SERP reports (`method: 'serp.report'`) require a paid Mutagen
subscription. Without it, calls return `error_id=111`. Free-tier methods: `balance`,
`check_key`, `progects`.

**Cookbook:** `~/.claude/skills/mutagen/references/cookbook.md` — ready-to-run recipes for
all 23 report types, async polling patterns, and pitfalls.

## Smart routing

Domain tools auto-resolve `account` when an explicit endpoint contains a `host_id` uniquely
owned by one account in the local inventory. Explicit `account` parameter always wins.

## Migrating from v0.4

v0.5 is a **breaking change**. Six narrow tools are removed. Use the generic gateways instead:

| Deleted v0.4 tool | v0.5 replacement |
|---|---|
| `webmaster_site_summary` | `yandex_webmaster_api({endpoint: "/user/{user_id}/hosts/{host_id}/summary"})` |
| `webmaster_top_queries` | `yandex_webmaster_api({endpoint: "/user/{user_id}/hosts/{host_id}/search-queries/all/history", params: {date_from, date_to}})` |
| `webmaster_indexing_issues` | `yandex_webmaster_api({endpoint: "/user/{user_id}/hosts/{host_id}/diagnostics/problems"})` |
| `metrika_search_phrases` | `yandex_metrika_api({endpoint: "/stat/v1/data", params: {id: counter_id, dimensions: "ym:s:searchPhrase", metrics: "ym:s:visits", ...}})` |
| `metrika_traffic_summary` | `yandex_metrika_api({endpoint: "/stat/v1/data", params: {id: counter_id, dimensions: "ym:s:trafficSource", metrics: "ym:s:visits", ...}})` |
| `wordstat_keywords` | `yandex_direct_api({endpoint: "/v5/keywordresearch", method: "POST", body: {method: "hasSearchVolume", params: {...}}})` |

**After upgrading from v0.4:** run `invalidate_cache({})` to clean orphan cache entries
that reference the deleted tool names.

See `~/.claude/skills/yandex-webmaster/references/cookbook.md` and sibling cookbooks for
complete endpoint examples.

## Query Result Cache

The generic API tools (`yandex_metrika_api`, `yandex_webmaster_api`, `yandex_direct_api`,
`mutagen_api`) and `mutagen_competition` cache results in a local SQLite table (`query_cache`)
keyed by a SHA-256 hash of normalized arguments + account_id.

| Tool | TTL |
|---|---|
| `yandex_metrika_api` | 3600 s (1 hour) — override with `MCP_YANDEX_SEO_CACHE_TTL_API` |
| `yandex_webmaster_api` | 3600 s (1 hour) — same env var |
| `yandex_direct_api` | 3600 s (1 hour) — same env var |
| `mutagen_competition` | 30 days — override with `MCP_YANDEX_SEO_CACHE_TTL_MUTAGEN_COMPETITION` |
| `mutagen_api` | 30 days (Mutagen data) — pass `force_refresh: true` to bypass |

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

## Migrating from v0.1 / v0.2

v0.2 is a breaking change. The following env vars are removed and no longer read:

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

## Smoke test

```bash
npm run build
export MCP_YANDEX_SEO_MASTER_KEY=$(openssl rand -hex 32)
export SMOKE_OAUTH_CLIENT_ID=<your_client_id>
export SMOKE_OAUTH_CLIENT_SECRET=<your_client_secret>
export SMOKE_ACCESS_TOKEN=<your_access_token>   # skips browser flow
npm run smoke
# For mutagen: SMOKE_MUTAGEN=1 npm run smoke -- --only=mutagen
# Generic API: npm run smoke -- --only=generic
```

Without `SMOKE_ACCESS_TOKEN` the runner prints the authorize URL and exits cleanly (code 0).

## Roadmap

See [docs/plans/mcp-yandex-seo/ROADMAP.md](docs/plans/mcp-yandex-seo/ROADMAP.md) for upcoming
versions:

- v0.3 — Inventory cache (list_sites, find_property, list_counters) ✓ done
- v0.4 — Query result cache with TTL ✓ done
- v0.5 — Generic API gateway (3 tools) ✓ done
- v0.6 — mutagen_api generic gateway for SERP reports (Мега-инструмент) ✓ done

## License

MIT

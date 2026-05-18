# @ohmy-seo/xmlstock v0.1.0

MCP server for Claude Code providing SERP data via the XMLStock API.
Exposes 3 tools: Yandex SERP lookup, Google SERP lookup, and usage/balance stats.
Results are cached locally in SQLite to avoid redundant paid API calls.

## Tools

| Tool | What it does |
|---|---|
| `xmlstock_yandex_serp` | Fetch Yandex SERP for a keyword. Cached per `MCP_XMLSTOCK_CACHE_TTL_SERP`. |
| `xmlstock_google_serp` | Fetch Google SERP for a keyword. Cached per `MCP_XMLSTOCK_CACHE_TTL_SERP`. |
| `xmlstock_usage_stats` | Return current XMLStock balance and usage counters. Cached per `MCP_XMLSTOCK_CACHE_TTL_STATS`. |

## Prerequisites

- Node.js 22+
- An active XMLStock account with API credentials (https://xmlstock.com)

## Install

```bash
cd /home/ubuntu/tools/ohmy-seo
pnpm install
cd packages/xmlstock
pnpm run build
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_XMLSTOCK_MASTER_KEY` | Yes | — | 32 hex bytes for local DB encryption. Generate: `openssl rand -hex 32` |
| `MCP_XMLSTOCK_DB_PATH` | No | `./data/state.db` | Path to local SQLite cache database |
| `XMLSTOCK_USER` | Yes | — | XMLStock account user ID |
| `XMLSTOCK_KEY` | Yes | — | XMLStock API key |
| `MCP_XMLSTOCK_CACHE_TTL_SERP` | No | `86400` | SERP cache TTL in seconds (default 24 h) |
| `MCP_XMLSTOCK_CACHE_TTL_STATS` | No | `300` | Stats cache TTL in seconds (default 5 min) |

## Connect to Claude Code

```bash
pnpm run build
claude mcp add mcp-xmlstock node /home/ubuntu/tools/ohmy-seo/packages/xmlstock/dist/index.js \
  -e MCP_XMLSTOCK_MASTER_KEY=$MCP_XMLSTOCK_MASTER_KEY \
  -e XMLSTOCK_USER=$XMLSTOCK_USER \
  -e XMLSTOCK_KEY=$XMLSTOCK_KEY
```

## Caching

Both SERP tools cache responses in a local SQLite database keyed by a hash of the
request parameters. Use `force_refresh: true` on any tool call to bypass the cache
and overwrite the stored entry.

| Tool | Default TTL |
|---|---|
| `xmlstock_yandex_serp` | 86400 s (24 h) — override with `MCP_XMLSTOCK_CACHE_TTL_SERP` |
| `xmlstock_google_serp` | 86400 s (24 h) — override with `MCP_XMLSTOCK_CACHE_TTL_SERP` |
| `xmlstock_usage_stats` | 300 s (5 min) — override with `MCP_XMLSTOCK_CACHE_TTL_STATS` |

## ⚠️ Smoke against live API costs money

Running `pnpm smoke -- --only=xmlstock` makes paid calls to XMLStock. To prevent
accidental credit burns:

- Smoke requires `SMOKE_XMLSTOCK_SPEND_OK=1` env var to run at all
- Max 2 paid calls per run (1 Yandex SERP + 1 Google SERP)
- Fixed cheap query: `query=seo`
- `force_refresh` defaults to false (uses cache when available)

Without `SMOKE_XMLSTOCK_SPEND_OK=1`, the xmlstock smoke group is SKIPPED.
The `cache` and `fixtures` groups are always free to run.

## Smoke instructions

```bash
# Free run (cache + fixture tests only — no paid calls):
pnpm smoke

# Full run with paid API calls (COSTS CREDITS — max 2 calls):
SMOKE_XMLSTOCK_SPEND_OK=1 \
XMLSTOCK_USER=<your_user> \
XMLSTOCK_KEY=<your_key> \
MCP_XMLSTOCK_MASTER_KEY=$(openssl rand -hex 32) \
pnpm smoke

# Run only fixture/parse tests (always free):
pnpm test:parse
```

## Security notes

- `XMLSTOCK_USER` and `XMLSTOCK_KEY` are never written to the local database.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- `MCP_XMLSTOCK_MASTER_KEY` is never logged or included in tool responses.

## License

MIT

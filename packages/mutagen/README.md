# @ohmy-seo/mutagen v0.1.0

MCP server for Claude Code providing focused tools for Mutagen.ru keyword
intelligence: competition scoring and a generic API gateway covering all
Mutagen report types. Secrets are encrypted in a local SQLite database
using AES-256-GCM. Results are cached locally to minimise API quota usage.

## Install

```bash
pnpm install
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_MUTAGEN_MASTER_KEY` | yes | — | 32 hex bytes for AES-256-GCM encryption. Generate: `openssl rand -hex 32` |
| `MUTAGEN_API_KEY` | yes | — | Mutagen.ru API key ([get key](https://mutagen.ru/?r=69383)). Required for both tools. |
| `MCP_MUTAGEN_DB_PATH` | no | `./data/state.db` | Path to the local SQLite state database |
| `MCP_MUTAGEN_CACHE_TTL` | no | `2592000` | Cache TTL in seconds (default 30 days) |

> WARNING: Do not run the server or smoke test without setting `MUTAGEN_API_KEY`.
> Both tools will fail immediately with an authentication error from the Mutagen API.

## Tools

### `mutagen_competition`

Keyword competition scoring via Mutagen. Returns a competition score on a
scale of 1–25 plus CPC cost estimates for one or more phrases. Results are
cached for `MCP_MUTAGEN_CACHE_TTL` seconds (default 30 days).

```
mutagen_competition({ phrases: ["купить ноутбук", "macbook pro"] })
```

### `mutagen_api`

Generic gateway to the full Mutagen.ru API covering all 23 SERP report types,
keyword analytics, balance checks, and project management. Handles async
polling automatically for long-running report requests.

```
mutagen_api({ method: "balance" })
mutagen_api({ method: "serp.report", params: { phrase: "seo продвижение", lr: 213 } })
mutagen_api({ method: "check_key" })
```

Available free-tier methods (no paid subscription required): `balance`,
`check_key`, `progects`.

SERP report methods (`serp.report` and its 22 variants) require a paid
Mutagen subscription. Without it the API returns `error_id=111`.

## Build

```bash
pnpm run build
```

Output is written to `./dist/`. The entry point `./dist/index.js` is the
MCP server binary registered as `mcp-mutagen`.

## Connect to Claude Code

```bash
pnpm run build
export MCP_MUTAGEN_MASTER_KEY=$(openssl rand -hex 32)
export MUTAGEN_API_KEY=<your_mutagen_api_key>
claude mcp add mcp-mutagen node /path/to/packages/mutagen/dist/index.js \
  -e MCP_MUTAGEN_MASTER_KEY=$MCP_MUTAGEN_MASTER_KEY \
  -e MUTAGEN_API_KEY=$MUTAGEN_API_KEY
```

## Smoke test

```bash
pnpm run build
export MCP_MUTAGEN_MASTER_KEY=$(openssl rand -hex 32)
export MUTAGEN_API_KEY=<your_mutagen_api_key>
pnpm run smoke
```

> WARNING: smoke test makes real API calls to Mutagen.ru. Do not run without
> a valid `MUTAGEN_API_KEY` — the server will exit with an auth error.

## Security

- `MUTAGEN_API_KEY` is encrypted with AES-256-GCM; master key lives only in env.
- `data/state.db` is created with `chmod 0600` — readable only by the owning user.
- The master key is never logged or included in tool responses.

## License

MIT

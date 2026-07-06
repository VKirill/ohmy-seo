# ohmy-seo

A monorepo of **Model Context Protocol (MCP) servers** for SEO & performance‑marketing automation — Yandex (Direct, Metrika, Webmaster), Google (Search Console, GA4, Tag Manager), and third‑party SERP/keyword tools. Built for LLM agents (Claude Code, Claude Desktop, or any MCP client) to read and safely write live advertising & analytics accounts.

The flagship is **`mcp-yandex-seo`** — a full "hands" toolset over **Yandex Direct**, built around the modern **Единая перформанс‑кампания (ЕПК / Unified Performance Campaign)** and **combinatorial `RESPONSIVE_AD`** model.

> ⚠️ These servers talk to **live ad accounts**. Every mutating operation is gated behind explicit environment flags **and** a per‑call confirmation (see [Safety](#safety)). Tokens are encrypted at rest.

---

## Packages

| Package | Version | MCP server | Description |
|---|---|---|---|
| `@ohmy-seo/mcp-core` | 0.3.0 | — | Shared infra: encrypted OAuth storage, SQLite cache, big‑int‑safe JSON, base types |
| `@ohmy-seo/yandex-seo` | **0.8.0** | `mcp-yandex-seo` | **Yandex Direct (ЕПК/combinatorial), Metrika, Webmaster** |
| `@ohmy-seo/mutagen` | 0.1.0 | `mcp-mutagen` | Keyword competition scoring (Mutagen.ru) |
| `@ohmy-seo/xmlstock` | 0.2.0 | `mcp-xmlstock` | SERP data (XMLStock API) |
| `@ohmy-seo/google-search-console` | 0.1.0 | `mcp-gsc` | Google Search Console + Indexing API |
| `@ohmy-seo/ga4` | 0.1.0 | `mcp-ga4` | GA4 Data + Admin API |
| `@ohmy-seo/gtm` | 0.1.0 | `mcp-gtm` | Google Tag Manager (read/write/publish/rollback) |

---

## Flagship: Yandex Direct (`mcp-yandex-seo`)

Yandex Direct has consolidated all ad formats into the **ЕПК** — classic single‑title text ads (ТГО/`TextAd`) and network banners (РСЯ/`TextImageAd`) are retired. This server is **combinatorial‑only**: every ad is one `RESPONSIVE_AD` carrying a pool of **1–7 titles × 1–3 texts** (Yandex assembles the best combination), created on the `/json/v501/` API.

What it can do (all verified live against the API):

- **Create** — ЕПК campaigns, ad groups, combinatorial ads, sitelinks, callouts, promo extensions, images; or upload a whole campaign from a **YAML bundle** (`upload_from_yaml`, dry‑run → plan‑hash → live).
- **Point‑edit live objects** — `update_campaign` / `update_adgroup` / `update_ad` change only the fields you pass (ad IDs are handled as strings — they exceed 2⁵³).
- **Bidding strategies** — a typed `strategy` param for the full set: manual (`HIGHEST_POSITION`), max clicks, average CPC, max conversions, average CPA, pay‑for‑conversion, CRR/ДРР. It builds a live‑compatible `{ Search, Network }` pair for you.
- **Bid adjustments (корректировки)** — mobile / desktop / video (device + video adjustments) via `set_bid_modifiers`.
- **Targeting** — campaign & group negative keywords (replace/append), excluded РСЯ sites, extended geo, hourly display schedule, attribution model.
- **Conversions** — Metrika counter + goals + per‑goal conversion value; pay‑for‑conversion / target‑CPA strategies.
- **Product feeds (товарные фиды)** — `feeds` (add/get/update/delete) with moderation status.
- **Read/report** — campaigns, ad groups, ads, keywords, stats (Reports v5), search terms, change history, XLSX export.
- **Escape hatch** — `yandex_direct_api`, a raw gateway to any Direct v5/v501 endpoint.

Currency‑agnostic throughout (USD, RUB, EUR, …) — money is integer **micros** and minimums come from `Dictionaries.get{Currencies}`.

**Grab the skill:** the [`skills/ohmy-seo-mcp/`](skills/ohmy-seo-mcp/) folder ships a ready‑to‑use agent skill (tool catalog, upload recipe, point‑editing playbook, safety pattern, and a `references/` file of live‑verified API quirks). Copy it into your Claude/agent skills directory so your agent knows how to drive this server.

---

## Requirements

- **Node.js ≥ 22**
- **pnpm** (`npm i -g pnpm`)

## Install & build

```bash
git clone https://github.com/VKirill/ohmy-seo.git
cd ohmy-seo
pnpm install
pnpm -r build          # compiles every package to dist/
pnpm -r test           # optional: run the test suites
```

## Configuration

Each server reads a `.env` from its package directory. Copy the example and fill it in:

```bash
cp packages/yandex-seo/.env.example packages/yandex-seo/.env
```

Required for `mcp-yandex-seo`:

| Variable | Purpose |
|---|---|
| `MCP_YANDEX_SEO_MASTER_KEY` | 32‑byte hex key that AES‑256‑GCM‑encrypts OAuth tokens & client secrets at rest. Generate with `openssl rand -hex 32`. **Keep it secret; losing it makes stored tokens unrecoverable.** |
| `OHMY_SEO_ALLOW_LIVE_MUTATIONS` | Global kill‑switch — must be `true` for **any** write. Leave unset to run read‑only. |
| `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS` | Platform‑specific write flag for Yandex Direct (isolated from other platforms). |

Optional integrations: `MUTAGEN_API_KEY`, `XMLSTOCK_USER` + `XMLSTOCK_KEY`. Google packages use Google OAuth or a Service Account. See each package's `.env.example`.

## Connect OAuth accounts

Yandex uses its own OAuth flow via the server's tools:

1. `register_oauth_app` — store your Yandex OAuth app (client_id + client_secret, encrypted).
2. `start_oauth_flow` — get the consent URL; approve it in the browser.
3. `complete_oauth_flow` — exchange the returned code for tokens.
4. `list_accounts` / `set_default_account` — manage connected accounts. Pass an account label to any tool via the optional `account` param; for agency sub‑cabinets pass `client_login`.

Google servers use `register_google_oauth_app` → `start_google_oauth_flow` → `complete_google_oauth_flow`, or `register_google_service_account`.

## Wire into an MCP client

Each server is a stdio process pointing at its built `dist/index.js`. Example MCP client config (Claude Desktop / any MCP client):

```json
{
  "mcpServers": {
    "mcp-yandex-seo": {
      "command": "node",
      "args": ["/absolute/path/to/ohmy-seo/packages/yandex-seo/dist/index.js"]
    }
  }
}
```

For **Claude Code**: `claude mcp add mcp-yandex-seo -- node /absolute/path/to/ohmy-seo/packages/yandex-seo/dist/index.js`. Restart the client after wiring — MCP tools are discovered at connection time.

---

## Safety

Writing to a live ad account is guarded by defence in depth:

1. **Global flag** — `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` (no writes at all without it).
2. **Platform flag** — `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` (isolated per platform).
3. **Per‑call `confirm: true`** on every mutating tool.
4. **`acknowledge_live` ack string** for destructive/high‑impact ops (delete, pause, moderate, budget, bid‑modifier delete) — the tool echoes the exact expected string.

Recommended pattern for agents: create campaigns in **DRAFT/OFF**, search‑only serving, manual or low weekly cap, **no auto‑moderation, no auto‑launch** — a human confirms before anything goes live. Read‑only tools (`list_*`, `get_*`, `*` in `get` mode) need no flags.

## Security notes

- OAuth access/refresh tokens and client secrets are **AES‑256‑GCM encrypted** in a local SQLite DB (`data/state.db`, git‑ignored). They are never returned by any tool.
- `.env`, `data/`, and Google `client_secret_*.json` are git‑ignored. Never commit them.
- The `MCP_YANDEX_SEO_MASTER_KEY` is the root of trust — store it out of band.

---

## Development

```bash
pnpm -r build              # build all
pnpm --filter @ohmy-seo/yandex-seo test     # test one package
pnpm -r exec tsc --noEmit  # typecheck all
```

The Yandex Direct package is organised as: `src/registry/*` (per‑domain tool registration), `src/tools/*` (one file per tool), `src/lib/payloads/*` (API payload builders), `src/lib/pipeline/*` (bundle upload engine). See [`skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md`](skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md) for the hard‑won API quirks before writing new Direct code.

## License

[MIT](LICENSE) © Kirill Vechkasov (VKirill)

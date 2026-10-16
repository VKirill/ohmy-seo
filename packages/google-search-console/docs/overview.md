---
title: Google Search Console workspace overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, mcp, workspace]
sources:
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/package.json
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/core/src/config/package-config.ts
  - packages/core/src/db/connection.ts
  - hosting/apps/gateway/src/runtime.ts
  - packages/google-search-console/src/lib/db/accounts-repo.ts
  - packages/google-search-console/src/lib/db/oauth-apps-repo.ts
  - packages/google-search-console/src/tools/start-google-oauth-flow.ts
---
# Google Search Console workspace overview

TL;DR: `@ohmy-seo/google-search-console` is a stdio MCP server that connects Google Search Console and Indexing API operations to Google accounts stored in an encrypted SQLite database; its executable entry point is `src/index.ts` and its public surface is the registered MCP tools (`packages/google-search-console/src/index.ts:41-59`, `packages/google-search-console/src/index.ts:444-449`).

## What it is

The workspace exposes Google Search Console property discovery, Search Analytics, URL inspection, sitemap management, Indexing API notifications, and Google credential management as MCP tools (`packages/google-search-console/src/index.ts:118-290`, `packages/google-search-console/src/index.ts:304-438`). OAuth apps, account credentials, and the selected default account are persisted through workspace-scoped repositories; secret fields are encrypted before database writes and removed from public list results (`packages/google-search-console/src/lib/db/accounts-repo.ts:55-79`, `packages/google-search-console/src/lib/db/oauth-apps-repo.ts:28-44`).

The package is consumed as an MCP server process. Its package manifest exposes the built executable as `mcp-gsc`, runs `src/index.ts` in development, and requires Node.js 22 or newer (`packages/google-search-console/package.json:1-25`). The hosted gateway also starts the built entry point when a connected Google provider requires it (`hosting/apps/gateway/src/runtime.ts:22-27`).

## Stack

- TypeScript, Node.js 22+, `tsx`, and TypeScript compiler (`packages/google-search-console/package.json:10-25`).
- MCP server and stdio transport from `@modelcontextprotocol/sdk` (`packages/google-search-console/src/index.ts:7-12`).
- Shared `@ohmy-seo/mcp-core` package for configuration, SQLite, OAuth, HTTP, encryption, cache, and error handling (`packages/google-search-console/package.json:16-22`, `packages/google-search-console/src/lib/gsc-client.ts:1-10`).

## Quick start

From the repository root, install workspace dependencies and build this package. Set `MCP_GSC_MASTER_KEY` to 64 hexadecimal characters before starting the executable; `resolvePackageConfig` rejects a missing or malformed key (`packages/google-search-console/package.json:10-14`, `packages/core/src/config/package-config.ts:46-59`).

```sh
pnpm install
pnpm --filter @ohmy-seo/google-search-console build
MCP_GSC_MASTER_KEY="$(openssl rand -hex 32)" node packages/google-search-console/dist/index.js
```

`MCP_GSC_DB_PATH` selects the SQLite file; otherwise the package uses `data/state.db` under the process working directory (`packages/core/src/config/package-config.ts:61-67`).

## Public entry points

`src/index.ts` is the only executable entry point. It loads the package `.env`, validates configuration, creates an MCP server named `mcp-gsc`, registers tools, and connects through stdio (`packages/google-search-console/src/index.ts:1-12`, `packages/google-search-console/src/index.ts:41-59`, `packages/google-search-console/src/index.ts:444-449`). The API reference lists every MCP tool and its upstream Google HTTP call in [api.md](api.md).

The tool implementations are grouped into [account and OAuth management](features/accounts-and-oauth.md), [Search Analytics](features/search-analytics.md), [URL inspection](features/url-inspection.md), [sitemaps](features/sitemaps.md), and [Indexing API publishing](features/indexing-api.md). Stored credential entities are described in [data-model.md](data-model.md).

## Configuration

The package-specific prefix is `MCP_GSC`. Required `MCP_GSC_MASTER_KEY` holds a 32-byte AES key encoded as 64 hex characters. Optional `MCP_GSC_DB_PATH` selects the state database. Cache TTL variables are `MCP_GSC_CACHE_TTL_SEARCH`, `MCP_GSC_CACHE_TTL_META`, and `MCP_GSC_CACHE_TTL_INSPECT`; `MCP_GSC_OAUTH_LOOPBACK_PORT` chooses the preferred callback listener port (`packages/core/src/config/package-config.ts:9-17`, `packages/core/src/config/package-config.ts:46-67`, `packages/google-search-console/src/index.ts:94-111`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:30-35`).

## Workspace consumers

The gateway runtime declares this package as its `gsc` server and supplies its built entry point, master-key variable, and database-path variable (`hosting/apps/gateway/src/runtime.ts:22-27`). The package manifest has a workspace dependency only on `@ohmy-seo/mcp-core`; no other package manifest declares a dependency on `@ohmy-seo/google-search-console` (`packages/google-search-console/package.json:16-22`).

## Where to look next

- [API reference](api.md) — MCP tool inputs, upstream Google methods and paths, and authorization scopes.
- [Features](features/accounts-and-oauth.md) — account setup and shared access behavior.
- [Data model](data-model.md) — stored OAuth apps and Google accounts.
- [Gotchas](gotchas.md) — implementation mismatches and error behavior.
- [Repository front page](../../../README.md) — monorepo entry point.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](api.md)
- [Google Tag Manager workspace overview](../../gtm/docs/overview.md)

---
title: Google Analytics 4 workspace overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [ga4, mcp, analytics]
sources:
  - packages/ga4/src/index.ts
  - packages/ga4/package.json
  - packages/ga4/src/lib/ga4-client.ts
  - packages/ga4/src/lib/account-resolver.ts
  - packages/core/src/config/package-config.ts
  - hosting/apps/gateway/src/runtime.ts
  - packages/ga4/src/lib/db/accounts-repo.ts
  - packages/ga4/src/lib/db/oauth-apps-repo.ts
  - packages/ga4/src/tools/start-google-oauth-flow.ts
---

# Google Analytics 4 workspace overview

TL;DR: `@ohmy-seo/ga4` is a stdio MCP server that manages Google credentials and exposes GA4 Data API reports plus GA4 Admin API reads and writes (packages/ga4/package.json:2-14, packages/ga4/src/index.ts:58-72).

## What it is

The workspace registers 24 MCP tools: nine credential and account tools, eight reads, and seven Admin API write tools. It is launched as `mcp-ga4` from the package binary; `main` validates configuration and connects an MCP stdio transport (packages/ga4/package.json:8-10, packages/ga4/src/index.ts:436-446).

Report requests go to Analytics Data API; property and configuration requests go to Analytics Admin API. The shared call layer checks granted scope, gets an access token, sends JSON, and classifies API and auth errors (packages/ga4/src/lib/ga4-client.ts:31-43, packages/ga4/src/lib/ga4-client.ts:44-117).

The package depends on `@ohmy-seo/mcp-core`. The hosted gateway starts the built package as a Google provider server (packages/ga4/package.json:15-18, hosting/apps/gateway/src/runtime.ts:22-27). See the root [system architecture](../../../README.md) for cross-workspace relationships.

## Stack

- Node.js >=22, TypeScript, and ESM (packages/ga4/package.json:4-6, packages/ga4/package.json:24-25).
- MCP SDK over stdio with Zod input schemas (packages/ga4/src/index.ts:8-10, packages/ga4/src/index.ts:58-73).
- `@ohmy-seo/mcp-core` provides config, database, OAuth, encryption, HTTP, cache, and error helpers (packages/ga4/package.json:15-18, packages/ga4/src/lib/ga4-client.ts:1-9).

## Entry points and use

`pnpm --filter @ohmy-seo/ga4 dev` runs `src/index.ts`; `pnpm --filter @ohmy-seo/ga4 build` compiles the `mcp-ga4` binary at `dist/index.js`. The smoke script is `pnpm --filter @ohmy-seo/ga4 smoke` (packages/ga4/package.json:8-14). The server registers its MCP tools in `src/index.ts` (packages/ga4/src/index.ts:104-434). See [API](api.md).

## Configuration

| Variable | Meaning | Source |
|---|---|---|
| `MCP_GA4_MASTER_KEY` | Required; 64 hex characters / 32 bytes for encryption. | packages/core/src/config/package-config.ts:43-58 |
| `MCP_GA4_DB_PATH` | Optional SQLite path; default `<process.cwd()>/data/state.db`. | packages/core/src/config/package-config.ts:61-68 |
| `MCP_GA4_CACHE_TTL_META` | Metadata cache TTL seconds; default 86,400. | packages/ga4/src/index.ts:42-47 |
| `MCP_GA4_CACHE_TTL_REPORT` | Report cache TTL seconds; default 3,600. | packages/ga4/src/index.ts:42-50 |
| `MCP_GA4_OAUTH_LOOPBACK_PORT` | Preferred OAuth callback port; default 8766. | packages/ga4/src/tools/start-google-oauth-flow.ts:30-35 |

`validateRequiredEnv` resolves package config before connecting and exits on missing or invalid configuration (packages/ga4/src/index.ts:93-96, packages/ga4/src/index.ts:436-439).

## Where to look next

- [Google account and OAuth management](features/accounts-and-oauth.md) covers credentials and account selection.
- [Reporting and metadata](features/reporting.md) covers reports and GA4 reads.
- [Property administration](features/property-administration.md) covers Admin API writes.
- [Data model](data-model.md) explains persisted credentials; [gotchas](gotchas.md) records code-specific traps.

The package manifest declares `@ohmy-seo/mcp-core` as its only runtime dependency (packages/ga4/package.json:15-18). The gateway invokes the compiled server (hosting/apps/gateway/src/runtime.ts:22-27).


---
title: Google Tag Manager workspace overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: low
tags: [gtm, mcp, google-tag-manager]
sources:
  - packages/gtm/src/index.ts
  - packages/gtm/package.json
  - packages/gtm/src/lib/gtm-client.ts
  - packages/gtm/src/lib/account-resolver.ts
  - packages/core/src/config/package-config.ts
  - hosting/apps/gateway/src/runtime.ts
  - packages/gtm/src/lib/confirm-gate.ts
---
# Google Tag Manager workspace overview

TL;DR: `@ohmy-seo/gtm` is a stdio MCP server that manages Google Tag Manager accounts, workspaces, tags, versions, user permissions, and Google credentials through 33 registered tools (`packages/gtm/src/index.ts:63-80`).

## What it is

The package exposes an MCP server named `mcp-gtm`; its executable starts the stdio transport after validating package configuration (`packages/gtm/src/index.ts:63-64`, `packages/gtm/src/index.ts:84-90`, `packages/gtm/src/index.ts:1057-1067`). MCP tools call the Google Tag Manager API v2 with an OAuth bearer token supplied by `@ohmy-seo/mcp-core` (`packages/gtm/src/lib/gtm-client.ts:1-8`, `packages/gtm/src/lib/gtm-client.ts:95-119`).

The workspace covers credential registration and account selection, GTM reads, confirmed edits, live publication, rollback, and destructive operations (`packages/gtm/src/index.ts:132-133`, `packages/gtm/src/index.ts:300-340`, `packages/gtm/src/index.ts:926-1047`). The feature details live in [Accounts and Google authorization](features/accounts-and-oauth.md), [GTM resources and changes](features/gtm-resources.md), and [Publishing, rollback, and destructive actions](features/release-and-safety.md).

## Stack

- TypeScript with Node.js `>=22`, compiled with TypeScript (`packages/gtm/package.json:10-12`, `packages/gtm/package.json:24-29`).
- MCP SDK server and stdio transport, Zod input validation, and `@ohmy-seo/mcp-core` for configuration, storage, encryption, cache, OAuth, and error formatting (`packages/gtm/src/index.ts:1-16`, `packages/gtm/package.json:18-22`).
- Google Tag Manager API v2 over `fetch` (`packages/gtm/src/lib/gtm-client.ts:17-18`, `packages/gtm/src/lib/gtm-client.ts:95-119`).

## Start and configuration

Run the package from the repository workspace with `pnpm --filter @ohmy-seo/gtm dev`; `dev` invokes `tsx src/index.ts`, while `build` compiles to `dist/` and `mcp-gtm` points at `dist/index.js` (`packages/gtm/package.json:5-17`). Startup requires `MCP_GTM_MASTER_KEY`, a 64-character hexadecimal key; `MCP_GTM_DB_PATH` overrides the SQLite file path, whose default is `data/state.db` relative to the process working directory (`packages/core/src/config/package-config.ts:9-17`, `packages/core/src/config/package-config.ts:37-68`). The server loads `packages/gtm/.env` relative to its entry module before validating the key (`packages/gtm/src/index.ts:1-5`, `packages/gtm/src/index.ts:84-90`).

The package registers eight cacheable GTM reads: six list tools use `MCP_GTM_CACHE_TTL_READ` (default 3600 seconds) and version reads use `MCP_GTM_CACHE_TTL_VERSIONS` (default 300 seconds). User-permission reads bypass cache (`packages/gtm/src/index.ts:93-130`).

## Public entry points

| Entry point | What it exposes | Evidence |
|---|---|---|
| `mcp-gtm` executable | Compiled stdio MCP server | `packages/gtm/package.json:5-8`, `packages/gtm/src/index.ts:1057-1067` |
| MCP tools | 33 tools for OAuth/account setup and GTM reads and writes | [API reference](api.md); registration groups at `packages/gtm/src/index.ts:132-133`, `packages/gtm/src/index.ts:300-340`, `packages/gtm/src/index.ts:926-1047` |
| Internal module exports | Resolver, confirmation gate, ETag client, and account/database helpers; package.json does not declare a library export map | `packages/gtm/src/lib/account-resolver.ts:4-57`, `packages/gtm/src/lib/confirm-gate.ts:7-103`, `packages/gtm/src/lib/gtm-client.ts:29-154`, `packages/gtm/package.json:1-17` |

## Workspace dependencies

The gateway launches the compiled `packages/gtm/dist/index.js`, injects the `MCP_GTM_MASTER_KEY` and `MCP_GTM_DB_PATH` settings, and marks the package as requiring Google credentials (`hosting/apps/gateway/src/runtime.ts:26`). No other workspace imports `@ohmy-seo/gtm` as a library; product consumers connect to the MCP server through its tool surface (`packages/gtm/package.json:5-8`, `hosting/apps/gateway/src/runtime.ts:26`).

The package depends on `@ohmy-seo/mcp-core` and Zod at runtime (`packages/gtm/package.json:18-22`). For monorepo architecture and shared Google authorization behavior, see [the monorepo project map](../../../docs/project.md) and [the Google Search Console workspace documentation](../../google-search-console/docs/overview.md).

## Where to look next

- [MCP tool reference](api.md)
- [Accounts and Google authorization](features/accounts-and-oauth.md)
- [GTM resources and changes](features/gtm-resources.md)
- [Publishing, rollback, and destructive actions](features/release-and-safety.md)
- [Stored data](data-model.md)
- [Code gotchas](gotchas.md)

<!-- lane-pilot:backlinks -->
## Referenced by

- [GTM MCP tool API](api.md)

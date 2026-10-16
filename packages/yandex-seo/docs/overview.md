---
title: Yandex SEO workspace overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, mcp, overview]
sources:
  - packages/yandex-seo/src/index.ts
  - packages/yandex-seo/package.json
  - packages/yandex-seo/src/registry/oauth.ts
  - packages/yandex-seo/src/registry/inventory.ts
  - packages/yandex-seo/src/registry/gateways.ts
  - packages/yandex-seo/src/registry/direct-read.ts
  - packages/yandex-seo/src/registry/direct-write.ts
  - packages/yandex-seo/src/registry/direct-bundle.ts
  - packages/yandex-seo/src/lib/api-gateway.ts
  - packages/yandex-seo/src/lib/db/accounts-repo.ts
  - packages/yandex-seo/src/lib/inventory/cache-policy.ts
  - packages/core/src/db/migrations.ts
  - hosting/apps/gateway/src/runtime.ts
  - tsconfig.json
  - pnpm-lock.yaml
  - packages/yandex-seo/src/lib/api/confirm-gate.ts
---
# Yandex SEO workspace overview

TL;DR: `@ohmy-seo/yandex-seo` is a stdio MCP server for Yandex OAuth, Webmaster, Metrika, and Direct workflows, including Direct campaign reads, gated mutations, and campaign bundle uploads (`packages/yandex-seo/src/index.ts:19-35,48-61`).

## What it is

The workspace builds the `mcp-yandex-seo` executable and registers MCP tools for OAuth and account management, property inventory, cache management, generic Yandex API gateways, and Yandex Direct operations (`packages/yandex-seo/package.json:1-15`, `packages/yandex-seo/src/index.ts:48-55`). The MCP server accepts tool calls over standard input/output; startup validates the shared master key before connecting the stdio transport (`packages/yandex-seo/src/index.ts:39-45,57-62`).

Direct mutation is gated by confirmation fields and global and platform environment flags; generic API gateways expose arbitrary supported endpoints while specialized tools implement Direct-oriented tasks (`packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`, `packages/yandex-seo/src/registry/gateways.ts:8-87`).

This workspace imports the SQLite, cache, HTTP, and encryption facilities from `@ohmy-seo/mcp-core`; the core workspace owns the shared database schema (`packages/yandex-seo/src/lib/api-gateway.ts:5-9`, `packages/yandex-seo/src/lib/db/accounts-repo.ts:1-4`, `packages/core/src/db/migrations.ts:4-26`). The workspace has no separate HTTP route server (`packages/yandex-seo/src/index.ts:7-8,57-61`). Its OAuth, inventory, and Direct tools are registered by the package entry point (`packages/yandex-seo/src/index.ts:48-55`; `packages/yandex-seo/src/registry/oauth.ts:13-15`; `packages/yandex-seo/src/registry/inventory.ts:9-10`; `packages/yandex-seo/src/registry/direct-read.ts:14-15`; `packages/yandex-seo/src/registry/direct-write.ts:27-28`; `packages/yandex-seo/src/registry/direct-bundle.ts:6-8`).

## Stack

- TypeScript ESM, built with `tsc`; development entry uses `tsx` (`packages/yandex-seo/package.json:4-14`).
- MCP SDK, Zod, `@ohmy-seo/mcp-core`, `better-sqlite3`, `undici`, `js-yaml`, `exceljs`, and `jimp` (`packages/yandex-seo/package.json:19-29`).

## Start and configuration

From the repository root, build and start the workspace with the package scripts (`packages/yandex-seo/package.json:8-14`):

```sh
pnpm --filter @ohmy-seo/yandex-seo build
pnpm --filter @ohmy-seo/yandex-seo start
```

The process loads a package-local `.env` relative to its entry file and calls `getMasterKey()` before starting; a missing or invalid key terminates startup (`packages/yandex-seo/src/index.ts:2-5,39-45,57-60`). The configuration flags for live Direct writes and cache lifetimes are documented on the owning [Direct operations](features/direct-operations.md) and [API gateways](features/api-gateways.md) pages (`packages/yandex-seo/src/lib/api/confirm-gate.ts:33-52`, `packages/yandex-seo/src/lib/inventory/cache-policy.ts:9-21`).

## Entry points and consumers

| Entry | How it is used | Evidence |
|---|---|---|
| `src/index.ts` | Executable MCP process; connects `StdioServerTransport` and registers each tool family | `packages/yandex-seo/src/index.ts:7-17,48-62` |
| `mcp-yandex-seo` | Installed binary target mapped to `dist/index.js` | `packages/yandex-seo/package.json:5-8` |
| Gateway runtime | The hosting gateway launches this workspace from `packages/yandex-seo/dist/index.js` | `hosting/apps/gateway/src/runtime.ts:23` |
| TypeScript project references | The root TypeScript configuration includes this workspace | `tsconfig.json:1-8` |

No other workspace package declares a runtime dependency on `@ohmy-seo/yandex-seo`; hosting launches the built executable by path (`hosting/apps/gateway/src/runtime.ts:22-28`, `pnpm-lock.yaml:196-197`). The package itself depends on `@ohmy-seo/mcp-core` for shared services (`packages/yandex-seo/package.json:19-29`).

## Where to look next

- [OAuth and accounts](features/oauth-and-accounts.md) — app credentials, authorization flow, account selection, token refresh.
- [Inventory and cache](features/inventory-and-cache.md) — Webmaster sites, Metrika counters, cache behavior.
- [API gateways](features/api-gateways.md) — generic Metrika, Webmaster, and Direct requests.
- [Direct operations](features/direct-operations.md) — reads, point edits, and confirmation gates.
- [Campaign bundles](features/campaign-bundles.md) — CSV and YAML campaign creation and recovery.
- [Gotchas](gotchas.md) — integration traps and failure behavior.
- [Root project context](../../../docs/project.md) — cross-workspace relationships and runtime context.

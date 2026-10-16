---
title: Google Ads Workspace — Overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-ads, mcp, overview]
sources:
  - packages/google-ads/src/index.ts
  - packages/google-ads/package.json
  - packages/core/src/config/package-config.ts
  - hosting/apps/gateway/src/runtime.ts
  - packages/google-ads/src/lib/ads-client.ts
  - packages/google-ads/src/tools/start-google-oauth-flow.ts
  - packages/google-ads/src/tools/register-google-service-account.ts
---

# Google Ads Workspace — Overview

**TL;DR:** `@ohmy-seo/google-ads` is a Node.js MCP server that connects Google Ads accounts, reads account and campaign data through GAQL, and submits guarded mutations through Google Ads API v25.

## What it is

The workspace packages account setup, Google Ads API calls, GAQL construction and validation, read/report tools, and campaign management tools behind the MCP server named `mcp-google-ads`. The server uses stdio locally and exposes its registered tools to MCP clients. Its registration and startup code are in `packages/google-ads/src/index.ts:8-12`, `packages/google-ads/src/index.ts:90-104`, and `packages/google-ads/src/index.ts:625-635`.

The package has two stored credential concepts: reusable Google OAuth app credentials and connected Ads accounts. The workspace accesses these through repositories; table definitions live in `@ohmy-seo/mcp-core` migrations. See the [data model](data-model.md) and [account setup](features/account-access.md). The service can authenticate with a user OAuth account or a service account (`packages/google-ads/src/tools/start-google-oauth-flow.ts:73-82`, `packages/google-ads/src/tools/register-google-service-account.ts:42-52`).

## Stack

- Node.js 22 or newer; TypeScript compiled with `tsc`; package scripts provide `build`, `test`, and `dev` (`packages/google-ads/package.json:5-16`, `packages/google-ads/package.json:32-34`).
- MCP SDK for the server and stdio transport; Zod for tool input schemas (`packages/google-ads/package.json:19-26`, `packages/google-ads/src/index.ts:8-10`).
- `@ohmy-seo/mcp-core` supplies package configuration, database, encryption, Google OAuth, HTTP, cache, and error helpers (`packages/google-ads/package.json:19-26`, `packages/google-ads/src/lib/ads-client.ts:1-10`).
- `undici` issues Google Ads API requests (`packages/google-ads/package.json:19-26`, `packages/google-ads/src/lib/ads-client.ts:5-6`).

## Quick start

From the repository root:

```sh
pnpm --filter @ohmy-seo/google-ads build
pnpm --filter @ohmy-seo/google-ads dev
```

The package's `dev` script runs `src/index.ts` with `tsx`; the built executable is `dist/index.js` and the binary name is `mcp-google-ads` (`packages/google-ads/package.json:5-16`). Before connecting stdio, `main` calls `validateRequiredEnv`, which invokes `resolvePackageConfig("google-ads")`; that resolver validates the master key and returns the database path (`packages/google-ads/src/index.ts:123-130`, `packages/google-ads/src/index.ts:625-628`, `packages/core/src/config/package-config.ts:53-68`).

## Entry points and configuration

`src/index.ts` registers the MCP tool schemas and delegates each call to a tool implementation. The package binary points to the built entry module (`packages/google-ads/src/index.ts:14-60`, `packages/google-ads/package.json:8-11`). The local process loads `packages/google-ads/.env` relative to the entry file (`packages/google-ads/src/index.ts:1-6`).

| Setting | Purpose | Evidence |
|---|---|---|
| `MCP_GOOGLE_ADS_MASTER_KEY` | 64 hexadecimal characters (32 bytes) used by the shared encryption helper for this package. Missing or invalid values stop startup. | `packages/core/src/config/package-config.ts:28-58`; `packages/google-ads/src/index.ts:123-130` |
| `MCP_GOOGLE_ADS_DB_PATH` | SQLite database file path; defaults to `<process.cwd()>/data/state.db`. | `packages/core/src/config/package-config.ts:61-68` |
| `MCP_GOOGLE_ADS_OAUTH_LOOPBACK_PORT` | Preferred port for the local OAuth callback listener; default is `8767`. | `packages/google-ads/src/tools/start-google-oauth-flow.ts:30-35` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Fallback manager account ID for calls that omit an explicit `login_customer_id`; non-digits are removed. | `packages/google-ads/src/lib/ads-client.ts:34-39`, `packages/google-ads/src/lib/ads-client.ts:198-204` |
| `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` | Must equal `true` (case-insensitive after trimming) for confirmed live mutations. Details are owned by [campaign management](features/campaign-management.md). | `packages/google-ads/src/lib/ads-client.ts:41-44` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Optional legacy header; if non-empty, the client still sends it. | `packages/google-ads/src/lib/ads-client.ts:22-32`, `packages/google-ads/src/lib/ads-client.ts:251-258` |

The gateway runtime maps this workspace to the `MCP_GOOGLE_ADS_MASTER_KEY` and `MCP_GOOGLE_ADS_DB_PATH` settings and marks Google as a provider requirement (`hosting/apps/gateway/src/runtime.ts:27`). Shared system-level context is in the [repository project guide](../../../docs/project.md) and [MCP core overview](../../core/docs/overview.md).

## Workspace relationships

This package directly depends on `@ohmy-seo/mcp-core` for shared infrastructure (`packages/google-ads/package.json:19-26`). The cloud gateway launches its compiled entry at `packages/google-ads/dist/index.js` (`hosting/apps/gateway/src/runtime.ts:27`). No other workspace package declares `@ohmy-seo/google-ads` as a package dependency; the provider is orchestrated by the gateway runtime (`hosting/apps/gateway/src/runtime.ts:27`).

## Where to look next

- [Account access](features/account-access.md) — OAuth apps, connected accounts, and service account registration.
- [Reads and reports](features/reads-and-reports.md) — customer discovery, GAQL, reports, cache, and read failures.
- [Campaign management](features/campaign-management.md) — write tools, previews, validation, and live-operation gates.
- [Data model](data-model.md) — stored Google Ads credentials and account configuration.
- [Gotchas](gotchas.md) — sharp edges in credential selection, queries, and mutations.
- [Repository project guide](../../../docs/project.md) — cross-workspace entry points and service boundaries.

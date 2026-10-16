---
title: MCP Core Overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [mcp-core, shared-library, overview]
sources:
  - packages/core/package.json
  - packages/core/src/index.ts
  - packages/core/src/db/connection.ts
  - packages/core/src/db/index.ts
  - packages/core/src/config/package-config.ts
  - packages/core/src/cache/index.ts
  - packages/core/src/google-oauth/index.ts
  - packages/core/src/http.ts
  - packages/core/src/errors.ts
  - packages/core/src/crypto/index.ts
  - packages/core/src/json-safe.ts
  - packages/google-search-console/package.json
  - packages/ga4/package.json
  - packages/gtm/package.json
  - packages/google-ads/package.json
  - packages/mutagen/package.json
  - packages/xmlstock/package.json
  - packages/yandex-seo/package.json
---
# MCP Core Overview

TL;DR: `@ohmy-seo/mcp-core` is the shared TypeScript library for SQLite access, response caching, Google OAuth helpers, secret encryption, HTTP requests, error conversion, and safe JSON parsing. Package code imports its public subpaths; it does not start an MCP server itself (`packages/core/package.json:5-32`, `packages/core/src/index.ts:1-7`).

## What it is

This workspace centralizes infrastructure used by the SEO and analytics MCP packages. Its package export map exposes the root API and the `google-oauth`, `cache`, `db`, `http`, `errors`, `crypto`, and `config` subpaths (`packages/core/package.json:5-32`). The root entry re-exports errors, HTTP helpers, JSON parsing, cache, database, and crypto; Google OAuth is a separate subpath (`packages/core/src/index.ts:1-7`, `packages/core/src/google-oauth/index.ts:1-46`).

Consumers include `yandex-seo`, `mutagen`, `xmlstock`, `google-search-console`, `ga4`, `gtm`, and `google-ads`, each declaring `@ohmy-seo/mcp-core` as a workspace dependency (`packages/yandex-seo/package.json:20`, `packages/mutagen/package.json:19`, `packages/xmlstock/package.json:19`, `packages/google-search-console/package.json:17`, `packages/ga4/package.json:18`, `packages/gtm/package.json:18`, `packages/google-ads/package.json:21`).

## Stack

- TypeScript ESM, compiled with `tsc` (`packages/core/package.json:4-4`, `packages/core/package.json:38-41`).
- SQLite via `better-sqlite3`; HTTP via `undici`; runtime validation dependency `zod` (`packages/core/package.json:42-46`).
- Tests use Vitest (`packages/core/package.json:38-46`).

## Quick start

From the monorepo root, build the workspace with `pnpm --filter @ohmy-seo/mcp-core build` (`packages/core/package.json:38-41`). Import a capability from its declared subpath, for example `@ohmy-seo/mcp-core/cache` or `@ohmy-seo/mcp-core/google-oauth` (`packages/core/package.json:5-32`).

## Configuration

`resolvePackageConfig(packageName)` returns a master key, SQLite path, and environment prefix. It maps known package names to prefixes and derives `MCP_<PACKAGE>` for unknown names; the key must contain 64 hexadecimal characters. A named database lookup calls this resolver; the no-argument database lookup uses the legacy `MCP_YANDEX_SEO_DB_PATH` or `data/state.db` path and skips the key check (`packages/core/src/config/package-config.ts:9-17`, `packages/core/src/config/package-config.ts:37-69`, `packages/core/src/db/connection.ts:25-30`, `packages/core/src/db/connection.ts:44-60`). HTTP timeout is read from `HTTP_TIMEOUT_MS` and defaults to 30,000 milliseconds (`packages/core/src/http.ts:12-15`). Cache TTL configuration is described in [the cache feature page](features/cache.md).

## Public entry points

| Import | Purpose |
|---|---|
| `@ohmy-seo/mcp-core` | Errors, HTTP, safe JSON, cache, database, crypto, and selected config/cache-registry functions (`packages/core/src/index.ts:1-7`). |
| `@ohmy-seo/mcp-core/google-oauth` | OAuth authorization-code and service-account flows, token broker, scope constants, Google error classification (`packages/core/src/google-oauth/index.ts:1-46`). |
| `@ohmy-seo/mcp-core/cache` | Cache key, policy, repository, and statistics APIs (`packages/core/src/cache/index.ts:1-4`). |
| `@ohmy-seo/mcp-core/db` | SQLite connection and migrations (`packages/core/src/db/index.ts:1-2`). |
| `@ohmy-seo/mcp-core/crypto` | Master-key selection and secret encryption (`packages/core/src/crypto/index.ts:1-2`). |
| `@ohmy-seo/mcp-core/config`, `/http`, `/errors` | Package config resolver, HTTP request helpers, error utilities (`packages/core/package.json:20-31`). |

## Where to look next

- [Cache](features/cache.md) — TTL policy, cache keys, SQLite operations, and exports.
- [Google OAuth](features/google-oauth.md) — OAuth modes, token broker, errors, and scopes.
- [SQLite](features/database.md) — connection selection, lifecycle, and migrations.
- [Secrets and configuration](features/secrets-and-package-config.md) — key mapping and cipher behavior.
- [HTTP, errors, and JSON](features/http-errors-and-json.md) — request behavior and shared helpers.
- [Data model](data-model.md) — SQLite entities and links to their domain pages.
- [Gotchas](gotchas.md) — sharp edges verified in the implementation.
- [Monorepo README](../../../README.md) — human-facing front page for the full project.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Workspace — Overview](../../google-ads/docs/overview.md)

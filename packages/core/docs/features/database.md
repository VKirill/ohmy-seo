---
title: SQLite Database Access
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [sqlite, database, mcp-core]
sources:
  - packages/core/src/db/connection.ts
  - packages/core/src/db/migrations.ts
  - packages/core/src/db/index.ts
  - packages/core/src/config/package-config.ts
  - packages/core/package.json
---
# SQLite Database Access

TL;DR: The database subpath caches one `better-sqlite3` connection per package key, creates parent directories, configures SQLite, and applies schema versions 1–4 on open (`packages/core/src/db/connection.ts:23-41`, `packages/core/src/db/migrations.ts:194-222`).

## Purpose

This feature owns SQLite connection lifecycle and migrations for the core-owned tables. Callers receive the raw synchronous `better-sqlite3` database object and implement their own repositories (`packages/core/src/db/connection.ts:44-61`, `packages/core/src/db/index.ts:1-2`).

## How it works

1. `getDb(packageName?)` uses the package name as its connection-cache key; no argument selects the legacy `yandex-seo` key (`packages/core/src/db/connection.ts:44-48`).
2. Named lookups resolve `${PREFIX}_DB_PATH` through package configuration. No-argument lookup reads `MCP_YANDEX_SEO_DB_PATH` or resolves `data/state.db` from the current working directory (`packages/core/src/db/connection.ts:25-30`, `packages/core/src/db/connection.ts:51-57`).
3. Opening creates the database directory, applies file mode `0600`, enables WAL, foreign keys and `synchronous=NORMAL`, then runs migrations (`packages/core/src/db/connection.ts:33-41`).
4. `applyMigrations` checks `PRAGMA user_version` and applies sequential migrations through version 4 (`packages/core/src/db/migrations.ts:194-222`).
5. `closeDb(packageName?)` closes and removes the cached connection, allowing a later lookup to reopen it (`packages/core/src/db/connection.ts:64-76`).

### Connection modes

| Mode | Database path selection | Key requirement |
|---|---|---|
| No argument | `MCP_YANDEX_SEO_DB_PATH` or `<cwd>/data/state.db` | Does not call package config or require a master key (`packages/core/src/db/connection.ts:25-30`, `packages/core/src/db/connection.ts:51-57`). |
| Named package | `${PREFIX}_DB_PATH` or `<cwd>/data/state.db` | Resolves package config and validates `${PREFIX}_MASTER_KEY` (`packages/core/src/config/package-config.ts:46-68`). |

### Failure behavior

- Directory creation, opening, chmod, pragma, or migration errors propagate from `getDb` (`packages/core/src/db/connection.ts:33-41`).
- Named package config throws if the master-key variable is absent or is not 64 hexadecimal characters (`packages/core/src/config/package-config.ts:53-59`).
- Migration V4 checks the `account_namespace` column before rebuilding the cache table; schema versions are recorded after each versioned transaction (`packages/core/src/db/migrations.ts:95-141`, `packages/core/src/db/migrations.ts:194-222`).

## Business rules

- The zero-argument database path is intentionally separate from named config and avoids master-key validation (`packages/core/src/db/connection.ts:18-21`, `packages/core/src/db/connection.ts:51-57`).
- Connection cache keys are package names, not resolved database paths; two names configured to the same path open separate connection instances (`packages/core/src/db/connection.ts:23-23`, `packages/core/src/db/connection.ts:44-60`).
- Schema version 4 removes the foreign key from `query_cache.account_id`, adds nullable `account_namespace`, and creates Google credential and GTM rollback tables (`packages/core/src/db/migrations.ts:87-93`, `packages/core/src/db/migrations.ts:105-116`, `packages/core/src/db/migrations.ts:143-190`).

## Public API

| Export | File:line | Purpose |
|---|---|---|
| `getDb`, `closeDb` | `packages/core/src/db/connection.ts:44-76` | Open or close the package-selected database. |
| `applyMigrations` | `packages/core/src/db/migrations.ts:194-222` | Apply schema versions to a database connection. |

## Package shape

- Connection setup and package cache: `db/connection.ts`.
- DDL and version changes: `db/migrations.ts`.
- Table meanings: [data model overview](../data-model.md) and its domain pages.

## Internal model

The module-level map holds live SQLite connections by package key. Each opened connection runs all pending migrations before it enters the map (`packages/core/src/db/connection.ts:23-23`, `packages/core/src/db/connection.ts:59-61`).

## Dependencies

The connection module uses `better-sqlite3`, Node filesystem/path APIs, and `resolvePackageConfig`; SQLite uses WAL and foreign-key enforcement (`packages/core/src/db/connection.ts:1-6`, `packages/core/src/db/connection.ts:33-40`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](../overview.md)

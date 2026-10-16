---
title: Core Response Cache
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [cache, sqlite, mcp-core]
sources:
  - packages/core/src/cache/cache-policy.ts
  - packages/core/src/cache/cache-keys.ts
  - packages/core/src/cache/query-cache-repo.ts
  - packages/core/src/cache/cache-stats.ts
  - packages/core/src/db/connection.ts
  - packages/core/src/db/migrations.ts
  - packages/core/src/cache/index.ts
---
# Core Response Cache

TL;DR: The cache registry assigns a TTL to registered tools, while `withCache` hashes tool, account, and arguments to reuse successful results in SQLite. Expiry prevents reads but does not itself delete old rows (`packages/core/src/cache/cache-policy.ts:72-155`).

## Purpose

The cache shares read results across MCP packages and tracks hits in `query_cache`. A registry entry supplies a default TTL and optional environment override; the wrapper skips cache reads on forced refresh, invokes the supplied function on misses, and writes successful eligible results (`packages/core/src/cache/cache-policy.ts:21-39`, `packages/core/src/cache/cache-policy.ts:114-155`).

## How it works

1. Packages register a tool name with explicit or environment-driven TTL configuration (`packages/core/src/cache/cache-policy.ts:21-35`).
2. `computeArgsHash` canonicalizes object key order, excludes undefined fields and `force_refresh`, then hashes tool name, account ID, and remaining arguments with SHA-256 (`packages/core/src/cache/cache-keys.ts:3-16`).
3. Unless `forceRefresh` is true, `withCache` looks up the hash and returns parsed JSON when `expires_at` is later than the current Unix second, incrementing hit count (`packages/core/src/cache/cache-policy.ts:126-136`).
4. On a miss or forced refresh it calls `fn`. A thrown error skips the write; a `skipCacheIf` match returns without writing (`packages/core/src/cache/cache-policy.ts:138-140`).
5. It resolves TTL, stores canonical arguments and serialized result with timestamps and hit counters, then returns the result (`packages/core/src/cache/cache-policy.ts:140-155`).

### TTL modes

| Configuration | Inputs | Result |
|---|---|---|
| Unknown name | Name absent from registry | TTL `0`; the wrapper can still write an entry that expires immediately (`packages/core/src/cache/cache-policy.ts:72-79`, `packages/core/src/cache/cache-policy.ts:140-154`). |
| Explicit seconds | `ttlSeconds` set | Value is cached in-memory and returned (`packages/core/src/cache/cache-policy.ts:81-85`). |
| Default | No environment key or variable missing/empty | Configured default seconds (`packages/core/src/cache/cache-policy.ts:87-97`). |
| Environment override | Positive finite numeric value | Floored to whole seconds and cached for the process (`packages/core/src/cache/cache-policy.ts:94-107`). |
| Invalid override | Non-finite or non-positive value | Warns and falls back to the configured default (`packages/core/src/cache/cache-policy.ts:99-103`). |

Legacy registrations include Yandex API tools at 3,600 seconds and Mutagen tools at 30 days, with environment names selected in the registration loop (`packages/core/src/cache/cache-policy.ts:8-15`, `packages/core/src/cache/cache-policy.ts:46-64`).

### Failure behavior

- A rejected `fn` call propagates its error and does not write a cache entry (`packages/core/src/cache/cache-policy.ts:138-139`).
- Invalid TTL environment input falls back to the default after logging a warning (`packages/core/src/cache/cache-policy.ts:99-103`).
- Invalid stored JSON throws during `JSON.parse` on a hit; there is no local recovery branch (`packages/core/src/cache/cache-policy.ts:130-135`).
- SQLite errors propagate from repository operations (`packages/core/src/cache/query-cache-repo.ts:16-55`).

## Business rules

- Cache identity includes tool name, nullable account ID, and all defined arguments except `force_refresh`; argument object key order does not affect the hash (`packages/core/src/cache/cache-keys.ts:3-16`).
- `accountNamespace` is persisted as metadata, but it is not part of `computeArgsHash` (`packages/core/src/cache/cache-policy.ts:126-128`, `packages/core/src/cache/cache-policy.ts:143-148`).
- Reads require `expires_at > now`; expiry does not delete the row. Deletion is an explicit repository operation (`packages/core/src/cache/cache-policy.ts:130-136`, `packages/core/src/cache/query-cache-repo.ts:65-99`).
- `deleteWhere` with an empty filter deletes every cache row because it emits no `WHERE` clause (`packages/core/src/cache/query-cache-repo.ts:65-98`).

## Public API

| Export | File:line | Purpose |
|---|---|---|
| `canonicalStringify`, `computeArgsHash` | `packages/core/src/cache/cache-keys.ts:3-16` | Deterministic cache key inputs. |
| `CACHEABLE_TOOLS`, `CacheableTool`, `CacheableToolConfig` | `packages/core/src/cache/cache-policy.ts:8-28` | Legacy names and registry configuration. |
| `registerCacheableTool`, `getToolCacheConfig`, `isCacheable`, `getTtlForTool`, `withCache`, `_clearTtlCache` | `packages/core/src/cache/cache-policy.ts:29-161` | Registry, TTL resolution, wrapper, test reset. |
| `getEntry`, `putEntry`, `incrementHit`, `deleteWhere`, `deleteByEndpointPrefix`, `countEntries`, `topByHits`, `recentStats` and associated types | `packages/core/src/cache/query-cache-repo.ts:3-157` | SQLite cache operations and summaries. |
| `computeCacheStats` | `packages/core/src/cache/cache-stats.ts:5-25` | Legacy database size and cache summary. |

## Package shape

- Key generation: `cache/cache-keys.ts`; policy/wrapper: `cache/cache-policy.ts`.
- SQLite storage and aggregation: `cache/query-cache-repo.ts`, `cache/cache-stats.ts`.
- Schema and database selection: [cache data model](../data-model/cache.md).

## Internal model

The registry and TTL memo are process-local maps. Cache entries are durable SQLite rows keyed by the argument hash; the repository receives an optional package name to select a named database (`packages/core/src/cache/cache-policy.ts:27-27`, `packages/core/src/cache/cache-policy.ts:70-70`, `packages/core/src/cache/query-cache-repo.ts:16-18`).

## Dependencies

The cache uses Node SHA-256 for key hashing and calls the core database connection and `query_cache` repository (`packages/core/src/cache/cache-keys.ts:1-1`, `packages/core/src/cache/query-cache-repo.ts:1-1`).

## Gotchas

- Call `registerCacheableTool` before `withCache` when a non-legacy tool needs a positive TTL; unknown tools resolve to zero (`packages/core/src/cache/cache-policy.ts:33-38`, `packages/core/src/cache/cache-policy.ts:72-79`).
- TTL values are memoized after first resolution; changing the environment variable later does not affect a cached value unless `_clearTtlCache` is called (`packages/core/src/cache/cache-policy.ts:70-75`, `packages/core/src/cache/cache-policy.ts:159-161`).
- An expired row remains stored until a caller deletes it (`packages/core/src/cache/cache-policy.ts:130-136`, `packages/core/src/cache/query-cache-repo.ts:65-99`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](../overview.md)

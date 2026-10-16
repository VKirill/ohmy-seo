---
title: Yandex property inventory and cache
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, inventory, cache]
sources:
  - packages/yandex-seo/src/tools/list-sites.ts
  - packages/yandex-seo/src/tools/list-counters.ts
  - packages/yandex-seo/src/registry/inventory.ts
  - packages/yandex-seo/src/lib/inventory/cache-policy.ts
  - packages/yandex-seo/src/lib/inventory/refresher.ts
  - packages/yandex-seo/src/lib/db/inventory-repo.ts
  - packages/yandex-seo/src/tools/find-property.ts
  - packages/yandex-seo/src/registry/cache.ts
  - packages/yandex-seo/src/lib/api-gateway.ts
---
# Yandex property inventory and cache

TL;DR: Inventory tools maintain cached Webmaster sites and Metrika counters per connected account, while cache tools inspect and invalidate cached API results (`packages/yandex-seo/src/registry/inventory.ts:9-97`, `packages/yandex-seo/src/registry/cache.ts:7-57`).

## Purpose

The inventory maps Yandex account access to site host IDs and Metrika counter IDs, so callers can list or search known properties before using domain APIs (`packages/yandex-seo/src/registry/inventory.ts:10-77`). Generic API responses use the core query cache; this page covers inventory and cache controls, while request semantics live in [API gateways](api-gateways.md) (`packages/yandex-seo/src/lib/api-gateway.ts:134-162`).

## How it works

1. `list_sites` and `list_counters` resolve eligible accounts, then call a cache policy for each account and inventory kind (`packages/yandex-seo/src/tools/list-sites.ts:1-36`, `packages/yandex-seo/src/tools/list-counters.ts:1-36`).
2. A cache miss (no metadata or no rows) waits for a refresh before returning rows; a stale populated cache returns its existing rows and starts a background refresh (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:41-90`).
3. Refreshers discover the Webmaster user ID when needed, fetch upstream records, upsert current rows, remove missing rows, and record refresh outcomes (`packages/yandex-seo/src/lib/inventory/refresher.ts:34-124`, `packages/yandex-seo/src/lib/db/inventory-repo.ts:74-145`).
4. `find_property` ensures the requested inventory is available, then searches site URLs, counter names, and IDs using case-insensitive matching and ranked results (`packages/yandex-seo/src/tools/find-property.ts:1-62`).
5. `refresh_inventory` forces refreshes for all eligible accounts or a selected account and kind; `invalidate_cache` and `cache_stats` operate on the shared API query cache (`packages/yandex-seo/src/registry/inventory.ts:79-97`, `packages/yandex-seo/src/registry/cache.ts:7-57`).

### Modes

| Mode | Inputs | Behavior and output | Evidence |
|---|---|---|---|
| Cold inventory | No refresh metadata or zero rows | Waits for upstream fetch and returns resulting rows | `packages/yandex-seo/src/lib/inventory/cache-policy.ts:47-56,73-82` |
| Fresh inventory | Last successful refresh within TTL | Returns stored rows without fetching | `packages/yandex-seo/src/lib/inventory/cache-policy.ts:47-64,73-90` |
| Stale inventory | Last successful refresh older than TTL | Returns stale rows immediately and launches async refresh | `packages/yandex-seo/src/lib/inventory/cache-policy.ts:48-62,74-88` |
| Forced refresh | Optional account and `sites` or `counters` kind | Fetches, upserts and reports counts and errors | `packages/yandex-seo/src/registry/inventory.ts:79-97`, `packages/yandex-seo/src/lib/inventory/refresher.ts:14-24` |
| Property search | Query plus optional `site` or `counter` filter | Returns up to 25 ranked matches | `packages/yandex-seo/src/registry/inventory.ts:54-77`, `packages/yandex-seo/src/tools/find-property.ts:1-62` |

### Failures

- Accounts without the required Webmaster or Metrika scope are skipped in refresh and produce no inventory rows for that pair (`packages/yandex-seo/src/lib/inventory/refresher.ts:34-47,85-98`).
- A failed background refresh is logged and leaves the previously returned stale rows in place (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:57-61,83-87`).
- Explicit refresh reports per-account failures instead of silently replacing cache state (`packages/yandex-seo/src/lib/inventory/refresher.ts:14-24,34-84`).

## Business rules

- Inventory TTL comes from `MCP_YANDEX_SEO_CACHE_TTL_HOURS`; absent, invalid, non-finite, or non-positive values use the 24-hour default (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:9-21`).
- Concurrent refreshes for the same account and kind share one promise (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:11-38`).
- Inventory upsert is transactional and removes old rows absent from the fetched result (`packages/yandex-seo/src/lib/db/inventory-repo.ts:74-105,121-145`).
- API query-cache invalidation tools support optional filters; cache operations are shared through `@ohmy-seo/mcp-core` (`packages/yandex-seo/src/registry/cache.ts:7-57`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `list_sites`, `list_counters` | `packages/yandex-seo/src/registry/inventory.ts:10-52` | List cached properties, refreshing a cold cache |
| `find_property` | `packages/yandex-seo/src/registry/inventory.ts:54-77` | Search sites and counters by text |
| `refresh_inventory` | `packages/yandex-seo/src/registry/inventory.ts:79-97` | Force a selected or full refresh |
| `invalidate_cache`, `cache_stats` | `packages/yandex-seo/src/registry/cache.ts:7-57` | Manage and inspect API query cache |

## Package shape

- `src/registry/inventory.ts` and `src/registry/cache.ts` expose MCP tools.
- `src/lib/inventory/` implements refresh policy and upstream fetching.
- `src/lib/db/inventory-repo.ts` reads and writes core-owned inventory tables.

## Internal model

Inventory state is partitioned by account and by kind (`sites` or `counters`). Refresh metadata tracks the last successful refresh; a failed refresh does not replace a stale snapshot with an empty result (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:41-90`, `packages/yandex-seo/src/lib/inventory/refresher.ts:34-124`).

## Dependencies

The feature uses Yandex Webmaster and Metrika clients, account resolution, and the shared SQLite database from `@ohmy-seo/mcp-core` (`packages/yandex-seo/src/lib/inventory/refresher.ts:1-12`, `packages/yandex-seo/src/lib/db/inventory-repo.ts:1-4`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex SEO workspace overview](../overview.md)

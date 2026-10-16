---
title: Search Analytics queries
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, analytics, search]
sources:
  - packages/google-search-console/src/tools/gsc-search-analytics.ts
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/google-search-console/src/lib/account-resolver.ts
  - packages/core/src/cache/cache-policy.ts
---
# Search Analytics queries

TL;DR: `gsc_search_analytics` posts a date-bounded Search Analytics query for a Search Console property, returns rows and aggregation metadata, and caches results by account and arguments (`packages/google-search-console/src/tools/gsc-search-analytics.ts:57-91`).

## Purpose

Expose Search Console performance data with optional dimensions, filters, search type, data state, pagination, and aggregation controls (`packages/google-search-console/src/index.ts:317-339`).

## How it works

1. Resolve the explicit account label or default account and require Search Console read scope (`packages/google-search-console/src/tools/gsc-search-analytics.ts:57-59`, `packages/google-search-console/src/lib/account-resolver.ts:40-64`).
2. Construct the upstream body from required dates and only the optional fields supplied (`packages/google-search-console/src/tools/gsc-search-analytics.ts:60-68`).
3. Look up a cached result using account ID, property URL, and query arguments; `force_refresh` bypasses the cache (`packages/google-search-console/src/tools/gsc-search-analytics.ts:71-78`, `packages/core/src/cache/cache-policy.ts:114-155`).
4. On a cache miss, POST to `/v1/sites/{encoded siteUrl}/searchAnalytics/query`, then return `rows`, `responseAggregationType`, and `raw_count` (`packages/google-search-console/src/tools/gsc-search-analytics.ts:79-91`).

| Mode or option | Input values and defaults | Output or limit | Evidence |
|---|---|---|---|
| Dimensions | `query`, `page`, `country`, `device`, `searchAppearance`, `date`; omitted means Google default grouping | Returned row keys follow selected dimensions | `packages/google-search-console/src/tools/gsc-search-analytics.ts:21-24`, `packages/google-search-console/src/index.ts:327-328` |
| Search type | `web`, `image`, `video`, `news`, `discover`, `googleNews`; omitted leaves API default | Filters the source search type | `packages/google-search-console/src/tools/gsc-search-analytics.ts:31-32` |
| Data state | `final` or `all`; omitted leaves API default | `all` includes recent rows per tool schema description | `packages/google-search-console/src/index.ts:329-331` |
| Pagination | `rowLimit` documented as 1–25,000 with default 1,000; `startRow` defaults to 0 | Upstream response contains at most selected page size | `packages/google-search-console/src/index.ts:331-333` |
| Aggregation | `auto`, `byPage`, or `byProperty`; omitted leaves API default | Response includes `responseAggregationType` | `packages/google-search-console/src/tools/gsc-search-analytics.ts:35-35`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:88-91` |
| Cache | TTL from `MCP_GSC_CACHE_TTL_SEARCH`, default 3,600 seconds; `force_refresh` bypasses lookup | Cache key includes tool, account ID, and canonicalized arguments | `packages/google-search-console/src/index.ts:94-97`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:71-78`, `packages/core/src/cache/cache-policy.ts:27-38`, `packages/core/src/cache/cache-policy.ts:130-155` |

**Failures:** Account selection or missing scope fails before the request (`packages/google-search-console/src/lib/account-resolver.ts:47-64`). `executeGscCall` returns classified auth/API failures as `{ok:false,...}` and propagates rate-limit errors; this feature returns `result.data` as the query payload without converting `ok:false` into an MCP error (`packages/google-search-console/src/lib/gsc-client.ts:100-118`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:79-91`).

## Business rules

- `siteUrl`, `startDate`, and `endDate` are required at the MCP boundary (`packages/google-search-console/src/index.ts:323-339`).
- The required scope is `SCOPE_GSC_READONLY`; a full `webmasters` grant also satisfies read-only scope (`packages/google-search-console/src/tools/gsc-search-analytics.ts:1`, `packages/google-search-console/src/lib/account-resolver.ts:30-38`).
- Only defined optional arguments are copied to the Google request body (`packages/google-search-console/src/tools/gsc-search-analytics.ts:60-68`).
- The MCP schema describes a row-limit range, but the implementation forwards the numeric value without local clamping or validation (`packages/google-search-console/src/index.ts:331-333`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:60-68`).

## Public API

| MCP tool | File:line | Purpose |
|---|---|---|
| `gsc_search_analytics` | `packages/google-search-console/src/index.ts:317-339` | Query clicks, impressions, CTR, and position for a property and date range |

## Package shape

The MCP schema and registration live in `src/index.ts`; request shaping, caching, and response shaping live in `src/tools/gsc-search-analytics.ts`; HTTP, OAuth token, and Google error handling are shared through `src/lib/gsc-client.ts` (`packages/google-search-console/src/index.ts:317-339`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:57-91`).

## Internal model

The tool maps its argument object into Google's Search Analytics query body and caches the normalized request result under the account-specific cache namespace by account ID (`packages/google-search-console/src/tools/gsc-search-analytics.ts:60-78`). It returns the rows array, optional response aggregation type, and row count rather than passing through the complete upstream response (`packages/google-search-console/src/tools/gsc-search-analytics.ts:88-91`).

## Dependencies

`@ohmy-seo/mcp-core` provides scope-aware OAuth token resolution, HTTP requests, classified errors, and cache storage (`packages/google-search-console/src/lib/gsc-client.ts:1-10`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:1-4`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](../api.md)
- [Google Search Console workspace gotchas](../gotchas.md)
- [Google Search Console workspace overview](../overview.md)

---
title: Sitemap management
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, sitemaps]
sources:
  - packages/google-search-console/src/tools/gsc-list-sitemaps.ts
  - packages/google-search-console/src/tools/gsc-submit-sitemap.ts
  - packages/google-search-console/src/tools/gsc-delete-sitemap.ts
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/google-search-console/src/lib/account-resolver.ts
---
# Sitemap management

TL;DR: This capability lists a property's submitted sitemaps and submits or deletes sitemap URLs through Search Console API calls; list results are cached, while successful writes invalidate that account's package cache (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:33-59`, `packages/google-search-console/src/lib/gsc-client.ts:89-99`).

## Purpose

Expose read and write operations for sitemaps belonging to a Search Console property (`packages/google-search-console/src/index.ts:365-417`).

## How it works

1. Resolve the explicit account or default and verify read scope for listing, full scope for submit/delete (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:33-35`, `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:31-36`, `packages/google-search-console/src/tools/gsc-delete-sitemap.ts:31-36`).
2. Listing checks the cache by account and property, then GETs `/webmasters/v3/sites/{siteUrl}/sitemaps` on a miss (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:36-59`).
3. Submit and delete URL-encode the property and sitemap URL and call the corresponding sitemap endpoint with PUT or DELETE (`packages/google-search-console/src/tools/gsc-submit-sitemap.ts:38-60`, `packages/google-search-console/src/tools/gsc-delete-sitemap.ts:38-61`).
4. The shared client clears entries for the account after a successful non-GET response; cache invalidation errors are swallowed (`packages/google-search-console/src/lib/gsc-client.ts:89-99`).

| Operation | Required input and scope | Upstream behavior | Result | Evidence |
|---|---|---|---|---|
| List | `siteUrl`; `SCOPE_GSC_READONLY` | GET property sitemap collection; cache TTL `MCP_GSC_CACHE_TTL_META`, default 86,400 seconds | `{ sitemap: [...] }` | `packages/google-search-console/src/tools/gsc-list-sitemaps.ts:33-59`, `packages/google-search-console/src/index.ts:109-111` |
| Submit | `siteUrl`, `feedpath`; `SCOPE_GSC_FULL` | PUT property and sitemap path | Success message or `{success:false,status,error}` | `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:31-61` |
| Delete | `siteUrl`, `feedpath`; `SCOPE_GSC_FULL` | DELETE property and sitemap path | Success message or `{success:false,status,error}` | `packages/google-search-console/src/tools/gsc-delete-sitemap.ts:31-61` |

**Failures:** Account resolution can fail for unknown label, absent default, or insufficient scope. The shared client returns classified authentication/API failures as `ok:false`; write tools convert these to `success:false`, while rate limits and unclassified errors propagate (`packages/google-search-console/src/lib/account-resolver.ts:47-64`, `packages/google-search-console/src/lib/gsc-client.ts:100-118`, `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:49-61`).

## Business rules

- Listing needs read scope; sitemap mutations need full Search Console scope (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:1`, `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:1`, `packages/google-search-console/src/tools/gsc-delete-sitemap.ts:1`).
- Both `siteUrl` and `feedpath` are required for mutations; listing requires `siteUrl` (`packages/google-search-console/src/index.ts:370-410`).
- A successful write invalidates cache entries associated with its account ID (`packages/google-search-console/src/lib/gsc-client.ts:89-99`).

## Public API

| MCP tool | File:line | Purpose |
|---|---|---|
| `gsc_list_sitemaps` | `packages/google-search-console/src/index.ts:365-377` | List sitemaps submitted for a property |
| `gsc_submit_sitemap` | `packages/google-search-console/src/index.ts:383-399` | Submit or resubmit a sitemap |
| `gsc_delete_sitemap` | `packages/google-search-console/src/index.ts:401-417` | Delete a sitemap submission |

## Package shape

Each tool has one implementation under `src/tools`; MCP schemas and dispatchers are in `src/index.ts`; URL construction, access tokens, error classification, and write invalidation are centralized in `src/lib/gsc-client.ts` (`packages/google-search-console/src/index.ts:365-417`, `packages/google-search-console/src/lib/gsc-client.ts:41-118`).

## Internal model

Google owns sitemap state. This package returns Google's list response or a mutation result and stores no sitemap table of its own (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:47-58`, `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:42-61`).

## Dependencies

The tools use shared Google OAuth scope constants and MCP cache support from `@ohmy-seo/mcp-core` (`packages/google-search-console/src/tools/gsc-list-sitemaps.ts:1-4`, `packages/google-search-console/src/tools/gsc-submit-sitemap.ts:1-3`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](../api.md)
- [Google Search Console workspace overview](../overview.md)

---
title: URL inspection
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, url-inspection, indexing]
sources:
  - packages/google-search-console/src/tools/gsc-url-inspection.ts
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/google-search-console/src/lib/account-resolver.ts
---
# URL inspection

TL;DR: `gsc_url_inspection` sends a URL Inspection API request for one URL and Search Console property, optionally localizes the result, and caches the returned data for one hour by default (`packages/google-search-console/src/tools/gsc-url-inspection.ts:41-81`, `packages/google-search-console/src/index.ts:99-102`).

## Purpose

Return Google's index inspection response for a URL under a specified Search Console property (`packages/google-search-console/src/index.ts:342-363`).

## How it works

1. Resolve the requested account or default and require read-only Search Console scope (`packages/google-search-console/src/tools/gsc-url-inspection.ts:41-48`).
2. Check the cache using account ID, property, inspection URL, and language code; this tool does not expose a force-refresh argument (`packages/google-search-console/src/tools/gsc-url-inspection.ts:49-61`).
3. On a cache miss, POST `inspectionUrl`, `siteUrl`, and the optional `languageCode` to `/v1/urlInspection/index:inspect` (`packages/google-search-console/src/tools/gsc-url-inspection.ts:62-77`).
4. Return the response data from the shared GSC client (`packages/google-search-console/src/tools/gsc-url-inspection.ts:71-80`).

| Variant | Input behavior | Cache behavior | Evidence |
|---|---|---|---|
| Default language | `languageCode` omitted | Key records `languageCode: null` | `packages/google-search-console/src/tools/gsc-url-inspection.ts:49-61` |
| Localized response | Optional BCP-47 language code | The language code participates in cache arguments | `packages/google-search-console/src/index.ts:347-350`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:53-58` |
| Cache lifetime | `MCP_GSC_CACHE_TTL_INSPECT`; default 3,600 seconds | TTL resolution and response storage are provided by `mcp-core` | `packages/google-search-console/src/index.ts:99-102`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:49-61` |

**Failures:** Missing default/explicit account and missing scope are raised during account resolution. Auth and API HTTP failures are returned by `executeGscCall` as error data, and this tool returns that data without converting it to an MCP error; rate-limit errors propagate (`packages/google-search-console/src/lib/account-resolver.ts:47-64`, `packages/google-search-console/src/lib/gsc-client.ts:100-118`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:71-80`).

## Business rules

- `siteUrl` and `inspectionUrl` are required; `languageCode` is optional (`packages/google-search-console/src/index.ts:347-363`).
- The implementation forwards the URL and property as provided; it does not locally verify that the inspected URL is within the property (`packages/google-search-console/src/tools/gsc-url-inspection.ts:63-77`).
- Account scope is `SCOPE_GSC_READONLY` (`packages/google-search-console/src/tools/gsc-url-inspection.ts:1`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:47-48`).

## Public API

| MCP tool | File:line | Purpose |
|---|---|---|
| `gsc_url_inspection` | `packages/google-search-console/src/index.ts:341-363` | Request index inspection for a URL |

## Package shape

Tool registration is in `src/index.ts`; argument mapping and cache use are in `src/tools/gsc-url-inspection.ts`; shared account and HTTP behavior are in `src/lib/account-resolver.ts` and `src/lib/gsc-client.ts` (`packages/google-search-console/src/index.ts:341-363`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:41-81`).

## Internal model

The tool treats the Google response as opaque data and caches that response. It does not persist inspection results in a domain table (`packages/google-search-console/src/tools/gsc-url-inspection.ts:49-81`).

## Dependencies

The capability uses `mcp-core` scope constants and cache functions, plus the workspace account resolver and shared GSC HTTP client (`packages/google-search-console/src/tools/gsc-url-inspection.ts:1-4`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](../api.md)
- [Google Search Console workspace overview](../overview.md)

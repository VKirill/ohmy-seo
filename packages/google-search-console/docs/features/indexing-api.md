---
title: Indexing API notifications
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, indexing-api]
sources:
  - packages/google-search-console/src/tools/gsc-indexing-publish.ts
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/tools/register-google-service-account.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/google-search-console/src/lib/account-resolver.ts
---
# Indexing API notifications

TL;DR: `gsc_indexing_publish` posts a URL update or deletion notification to Google's Indexing API using an account granted the Indexing scope; the tool documents a service-account OWNER requirement and supported structured-data page types (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:8-15`, `packages/google-search-console/src/tools/gsc-indexing-publish.ts:41-80`).

## Purpose

Send a Google Indexing API URL notification for a page update or deletion (`packages/google-search-console/src/index.ts:419-438`).

## How it works

1. Resolve the supplied account or default account and require `SCOPE_INDEXING` (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:41-46`).
2. Obtain an access token and POST `{url,type}` to `https://indexing.googleapis.com/v3/urlNotifications:publish` (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:48-55`).
3. If the call succeeds, extract `urlNotificationMetadata.latestUpdate.notifyTime` and return it, or `null` if absent (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:72-80`).

| Mode | Input | Behavior and limits | Evidence |
|---|---|---|---|
| Updated URL | `type: URL_UPDATED` | Notify Google that an eligible page is new or changed | `packages/google-search-console/src/index.ts:427-431` |
| Deleted URL | `type: URL_DELETED` | Notify Google that an eligible page was removed | `packages/google-search-console/src/index.ts:427-431` |
| Account | Optional account label; default is used when absent | Tool description requires a service account with OWNER role on the Search Console property; documented default quota is 200 calls/day/project | `packages/google-search-console/src/tools/gsc-indexing-publish.ts:10-15`, `packages/google-search-console/src/tools/gsc-indexing-publish.ts:46-55` |
| Supported content | Fully qualified URL | Tool description limits use to JobPosting, BroadcastEvent, and LivestreamEvent URLs | `packages/google-search-console/src/tools/gsc-indexing-publish.ts:10-15` |

**Failures:** A 403 is returned with a specific OWNER-role diagnostic. Other classified auth/API errors return `success:false` with status and error data; rate limits and unclassified errors propagate (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:57-69`, `packages/google-search-console/src/lib/gsc-client.ts:100-118`).

## Business rules

- `url` and `type` are required; `type` is restricted to `URL_UPDATED` or `URL_DELETED` (`packages/google-search-console/src/index.ts:427-438`).
- The Indexing API scope is checked before token acquisition and again by the shared client (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:1`, `packages/google-search-console/src/tools/gsc-indexing-publish.ts:46-55`, `packages/google-search-console/src/lib/gsc-client.ts:45-51`).
- The tool's description limits use to JobPosting, BroadcastEvent, and LivestreamEvent URLs and warns that ordinary pages are outside the supported use described by the code (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:8-15`).

## Public API

| MCP tool | File:line | Purpose |
|---|---|---|
| `gsc_indexing_publish` | `packages/google-search-console/src/index.ts:419-438` | Publish URL update/deletion notification to Google Indexing API |

## Package shape

The MCP dispatcher and Zod schema are in `src/index.ts`; the request implementation is in `src/tools/gsc-indexing-publish.ts`; access tokens, HTTP, and error classification are shared through `src/lib/gsc-client.ts` (`packages/google-search-console/src/index.ts:419-438`, `packages/google-search-console/src/tools/gsc-indexing-publish.ts:41-80`).

## Internal model

This operation does not write a workspace database record. It returns a success message and the provider notification time, or a structured error result (`packages/google-search-console/src/tools/gsc-indexing-publish.ts:57-80`).

## Dependencies

Service-account registration can create credentials for this scope after validating the JSON key through a token exchange (`packages/google-search-console/src/tools/register-google-service-account.ts:25-52`). The request path uses MCP core OAuth and HTTP behavior through the shared client (`packages/google-search-console/src/lib/gsc-client.ts:1-10`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](../api.md)
- [Google Search Console workspace overview](../overview.md)

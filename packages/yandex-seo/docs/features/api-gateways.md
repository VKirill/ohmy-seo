---
title: Yandex API gateways
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, api, gateways]
sources:
  - packages/yandex-seo/src/registry/_shared.ts
  - packages/yandex-seo/src/registry/gateways.ts
  - packages/yandex-seo/src/lib/api-gateway.ts
  - packages/yandex-seo/src/lib/api/endpoints-spec.ts
  - packages/yandex-seo/src/lib/api/url-builder.ts
  - packages/yandex-seo/src/lib/api/invalidation.ts
  - packages/yandex-seo/src/lib/account-resolver.ts
  - packages/yandex-seo/src/lib/api/reports-polling.ts
---
# Yandex API gateways

TL;DR: Three MCP tools send caller-selected requests to Yandex Metrika, Webmaster, and Direct APIs, resolving OAuth, caching GETs, and invalidating cached reads after successful writes (`packages/yandex-seo/src/registry/gateways.ts:8-87`, `packages/yandex-seo/src/lib/api-gateway.ts:85-162`).

## Purpose

The gateway tools provide endpoint-level access where a specialized tool does not cover an API operation: `yandex_metrika_api`, `yandex_webmaster_api`, and `yandex_direct_api` (`packages/yandex-seo/src/registry/gateways.ts:8-87`). API base URLs, required OAuth scopes, auth prefixes, and default methods are configured in the endpoint spec (`packages/yandex-seo/src/lib/api/endpoints-spec.ts:1-44`).

## How it works

1. The MCP registry validates a common endpoint, HTTP method, params, body, account, and cache-bypass input; Direct adds `client_login` (`packages/yandex-seo/src/registry/_shared.ts:1-12`, `packages/yandex-seo/src/registry/gateways.ts:59-87`).
2. The gateway selects the API spec, resolves an account with the required scope, and obtains a valid access token (`packages/yandex-seo/src/lib/api-gateway.ts:85-94`).
3. It joins the base URL and endpoint, encodes query parameters, sets the API auth header, and adds `Client-Login` for a Direct agency request when supplied (`packages/yandex-seo/src/lib/api/url-builder.ts:10-43`, `packages/yandex-seo/src/lib/api-gateway.ts:94-107`).
4. Request bodies that arrive as JSON strings are parsed when they represent objects or arrays; unsafe integer IDs are rejected before JSON serialization (`packages/yandex-seo/src/lib/api-gateway.ts:46-78,108-118`).
5. GET requests use the core cache with account ID and normalized arguments in the key; errors are not cached. Successful non-GET requests invalidate related cached reads (`packages/yandex-seo/src/lib/api-gateway.ts:120-162`).
6. HTTP/API errors are normalized to `{ok:false,status,body}`; auth and rate-limit errors retain their typed failure behavior (`packages/yandex-seo/src/lib/api-gateway.ts:120-132`).

### Modes

| API | Auth and account scope | Cache and output behavior | Evidence |
|---|---|---|---|
| Metrika | OAuth bearer token; Metrika read scope | GET cached; successful write invalidates related GET entries | `packages/yandex-seo/src/lib/api/endpoints-spec.ts:8-16`, `packages/yandex-seo/src/lib/api-gateway.ts:134-162` |
| Webmaster | OAuth bearer token; Webmaster host-info scope | GET cached; successful write invalidates related GET entries | `packages/yandex-seo/src/lib/api/endpoints-spec.ts:17-25`, `packages/yandex-seo/src/lib/api-gateway.ts:134-162` |
| Direct | OAuth bearer token; Direct API scope; optional `Client-Login` | GET cached; successful write invalidates related GET entries | `packages/yandex-seo/src/lib/api/endpoints-spec.ts:26-34`, `packages/yandex-seo/src/lib/api-gateway.ts:100-106,134-162` |
| Cache bypass | `force_refresh: true` on GET | Fetches upstream and replaces cache entry | `packages/yandex-seo/src/lib/api-gateway.ts:145-161` |

### Failures

- Account resolution fails when no account has the API's required scope or an explicit label is invalid (`packages/yandex-seo/src/lib/account-resolver.ts:6-47`).
- An integer ID outside JavaScript's safe range is rejected with an instruction to pass it as a quoted digit string (`packages/yandex-seo/src/lib/api-gateway.ts:59-78`).
- Auth and rate-limit exceptions propagate; callers receive normalized status and body for other API errors (`packages/yandex-seo/src/lib/api-gateway.ts:120-132`).
- Failed GET results are excluded from cache; unsuccessful writes do not run cache invalidation (`packages/yandex-seo/src/lib/api-gateway.ts:134-162`).
- Report polling has a separate Direct report lifecycle helper; transient failure classification and TSV parsing are implemented in `reports-polling.ts` (`packages/yandex-seo/src/lib/api/reports-polling.ts:26-66,74-133`).

## Business rules

- Methods are restricted to GET, POST, PUT, and DELETE, with API-specific defaults in the endpoint spec (`packages/yandex-seo/src/registry/_shared.ts:1-12`, `packages/yandex-seo/src/lib/api/endpoints-spec.ts:8-34`).
- Successful write requests invalidate cache entries for the same API and related endpoint; failed requests leave cache untouched (`packages/yandex-seo/src/lib/api-gateway.ts:134-142`, `packages/yandex-seo/src/lib/api/invalidation.ts:5-15`).
- IDs beyond 2^53−1 cannot be sent as JSON numbers; callers must use digit strings (`packages/yandex-seo/src/lib/api-gateway.ts:59-78`).
- The Direct `client_login` field is sent only when the Direct API spec supports it and a value is provided (`packages/yandex-seo/src/lib/api-gateway.ts:104-106`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `yandex_metrika_api` | `packages/yandex-seo/src/registry/gateways.ts:9-32` | Request a Metrika API endpoint |
| `yandex_webmaster_api` | `packages/yandex-seo/src/registry/gateways.ts:34-57` | Request a Webmaster API endpoint |
| `yandex_direct_api` | `packages/yandex-seo/src/registry/gateways.ts:59-87` | Request a Direct v5 endpoint |

## Package shape

- `src/registry/gateways.ts` owns the tool schemas.
- `src/lib/api-gateway.ts` handles request execution and caching.
- `src/lib/api/` contains endpoint metadata, URL construction, cache invalidation, and Direct report helpers.

## Internal model

The gateway maps each API name to a base URL, auth prefix, required scope, and default method. It relies on account resolution and token refresh rather than storing credentials in request inputs (`packages/yandex-seo/src/lib/api/endpoints-spec.ts:3-44`, `packages/yandex-seo/src/lib/api-gateway.ts:85-107`).

## Dependencies

The request path uses shared HTTP, parsing, errors, and cache helpers from `@ohmy-seo/mcp-core` (`packages/yandex-seo/src/lib/api-gateway.ts:5-9`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex Direct operations](direct-operations.md)
- [Yandex property inventory and cache](inventory-and-cache.md)
- [Yandex SEO workspace overview](../overview.md)

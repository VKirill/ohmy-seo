---
title: HTTP, Error Conversion, and Safe JSON
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [http, errors, json, mcp-core]
sources:
  - packages/core/src/http.ts
  - packages/core/src/errors.ts
  - packages/core/src/json-safe.ts
  - packages/core/package.json
  - packages/core/src/index.ts
---
# HTTP, Error Conversion, and Safe JSON

TL;DR: The HTTP helper applies a timeout and common headers, maps selected HTTP statuses to typed errors, parses successful JSON while preserving unsafe integer literals as strings, and filters authorization headers from returned metadata (`packages/core/src/http.ts:12-64`).

## Purpose

This feature supplies shared HTTP and MCP error helpers plus a JSON parser that prevents JavaScript number rounding for integers outside the safe range (`packages/core/src/http.ts:12-64`, `packages/core/src/json-safe.ts:1-9`).

## How it works

1. `request` reads `HTTP_TIMEOUT_MS` (default 30,000 ms), creates an abort timer, and sends the request through `undici.fetch` with JSON-oriented headers and caller header overrides (`packages/core/src/http.ts:12-32`).
2. Status 401 becomes `AuthError`; 403 and other 4xx/5xx statuses become `ApiError`; 429 becomes `RateLimitError` using `Retry-After` or 60 seconds (`packages/core/src/http.ts:34-53`).
3. Successful bodies are read as text and parsed with `parseJsonSafe`; returned headers omit `authorization` (`packages/core/src/http.ts:55-63`).
4. `quoteUnsafeIntegers` scans outside JSON strings, detects full integer tokens, and quotes integers outside JavaScript's safe range while leaving fractions and exponent forms alone (`packages/core/src/json-safe.ts:19-105`).
5. `errorToMcpContent` converts typed errors and other thrown values into MCP error text, applying output sanitization and truncating API/unexpected messages to 500 characters (`packages/core/src/errors.ts:68-107`).

### Response and error modes

| Input | Output/failure |
|---|---|
| HTTP 2xx | Parsed `data`, status, and headers without authorization (`packages/core/src/http.ts:55-63`). |
| HTTP 401 | `AuthError(status)` (`packages/core/src/http.ts:36-38`). |
| HTTP 403 or other status >= 400 | `ApiError(status, body)` (`packages/core/src/http.ts:40-53`). |
| HTTP 429 | `RateLimitError`; parse `Retry-After`, fallback to 60 seconds (`packages/core/src/http.ts:45-48`). |
| Unsafe integer JSON literal | Exact decimal text becomes a JSON string; safe numbers remain numbers (`packages/core/src/json-safe.ts:77-95`). |
| Invalid successful JSON | `parseJsonSafe` propagates `JSON.parse` error (`packages/core/src/json-safe.ts:107-110`). |

### Failure behavior

- Fetch aborts at the configured timeout, and fetch-level errors propagate (`packages/core/src/http.ts:13-32`).
- Error bodies for 403 and other error statuses are returned inside `ApiError`; MCP formatting sanitizes and truncates that body (`packages/core/src/http.ts:40-53`, `packages/core/src/errors.ts:95-105`).
- Numeric `Retry-After` parsing uses `parseInt`; the fallback applies only when the header is absent (`packages/core/src/http.ts:45-48`).

## Business rules

- Integers are converted to strings only when their magnitude exceeds `Number.MAX_SAFE_INTEGER` or is below its negative; decimal and exponent numbers remain numeric (`packages/core/src/json-safe.ts:11-12`, `packages/core/src/json-safe.ts:62-95`).
- Sanitization replaces bearer/OAuth credentials, selected token JSON fields, client-secret query values, and authorization codes matching the implemented patterns (`packages/core/src/errors.ts:68-78`).
- Error text uses fixed mappings for auth and rate-limit failures, and limits embedded API/unexpected details to the first 500 characters (`packages/core/src/errors.ts:85-107`).

## Public API

| Export | File:line | Purpose |
|---|---|---|
| `HttpResponse`, `request`, `safeLogUrl` | `packages/core/src/http.ts:6-68` | HTTP request and URL sanitization. |
| `AuthError`, `RateLimitError`, `ApiError`, `OAuthFlowError`, `AccountNotFoundError`, `AmbiguousSiteError`, `NoMatchingAccountError` | `packages/core/src/errors.ts:1-67` | Typed shared errors. |
| `sanitizeForOutput`, `errorToMcpContent` | `packages/core/src/errors.ts:68-108` | Redaction and MCP-shaped error result. |
| `quoteUnsafeIntegers`, `parseJsonSafe` | `packages/core/src/json-safe.ts:19-110` | Big-integer-safe JSON parsing. |

## Package shape

- HTTP wrapper: `http.ts`.
- Error types, sanitization, and MCP conversion: `errors.ts`.
- Unsafe integer parser: `json-safe.ts`.

## Internal model

The HTTP wrapper owns response classification and parsing, while callers receive typed thrown errors or a normalized response object. The lower-level JSON parser is also exported for callers that parse responses outside `request` (`packages/core/src/http.ts:34-63`, `packages/core/src/json-safe.ts:107-110`).

## Dependencies

The HTTP wrapper imports `fetch` from `undici`; error conversion and safe parsing use Node/JavaScript built-ins (`packages/core/src/http.ts:1-4`, `packages/core/src/json-safe.ts:1-1`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](../overview.md)

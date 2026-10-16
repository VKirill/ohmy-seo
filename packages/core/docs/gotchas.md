---
title: MCP Core Gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [gotchas, mcp-core, reliability]
sources:
  - packages/core/src/cache/cache-policy.ts
  - packages/core/src/cache/query-cache-repo.ts
  - packages/core/src/cache/cache-keys.ts
  - packages/core/src/google-oauth/token-broker.ts
  - packages/core/src/http.ts
  - packages/core/src/config/package-config.ts
  - packages/core/src/db/connection.ts
  - packages/core/src/errors.ts
---
# MCP Core Gotchas

TL;DR: Several core helpers have process-level caches and implicit defaults; callers need to account for cache identity, token persistence, timeout scope, and redaction boundaries (`packages/core/src/cache/cache-policy.ts:70-75`, `packages/core/src/google-oauth/token-broker.ts:1-8`, `packages/core/src/http.ts:12-32`).

## Critical

### Cache namespace does not participate in the cache key

**Problem:** `accountNamespace` is stored on the cache row but `computeArgsHash` hashes only tool name, account ID, and arguments. Two providers using the same tool name, account ID, and arguments in one database share a key (`packages/core/src/cache/cache-policy.ts:126-128`, `packages/core/src/cache/cache-policy.ts:143-148`, `packages/core/src/cache/cache-keys.ts:12-16`).

**Risk:** When those identifiers collide, a result from one logical namespace is served to the other.

**Workaround:** Use globally distinct tool names or account identifiers for namespaces that share the same database.

### `deleteWhere` accepts an empty filter

**Problem:** With no filter fields, the repository constructs `DELETE FROM query_cache` without a `WHERE` clause (`packages/core/src/cache/query-cache-repo.ts:65-98`).

**Risk:** A caller expecting a no-op can erase every cache entry.

**Workaround:** Require at least one filter in callers before invoking the repository.

## High

### Token refresh does not update stored credentials

**Problem:** `getGoogleAccessToken` receives decrypted values and returns the refreshed access token, while the module explicitly leaves persistence to the caller (`packages/core/src/google-oauth/token-broker.ts:1-8`, `packages/core/src/google-oauth/token-broker.ts:76-100`).

**Risk:** Callers that do not persist the returned token repeat refresh work and can keep using stale expiry state.

**Workaround:** Persist the returned token and its new expiry in the workspace repository.

### The HTTP timer ends when headers arrive

**Problem:** The timeout's `finally` clears the timer immediately after `fetch` resolves; response body reading and JSON parsing happen later (`packages/core/src/http.ts:13-32`, `packages/core/src/http.ts:55-63`).

**Risk:** `HTTP_TIMEOUT_MS` does not bound a stalled body read or parse phase.

**Workaround:** For endpoints with streamed or slow bodies, provide caller-managed cancellation that covers body consumption.

## Medium

### Cache TTL overrides are memoized

**Problem:** The first resolved TTL is stored in a process-local map; subsequent environment changes do not affect that tool until the map is cleared (`packages/core/src/cache/cache-policy.ts:70-75`, `packages/core/src/cache/cache-policy.ts:94-107`, `packages/core/src/cache/cache-policy.ts:159-161`).

**Risk:** Runtime edits to TTL environment variables do not change cache duration for already-resolved tool names.

**Workaround:** Set TTL variables before the first lookup or restart the process.

### Root database access silently selects the legacy Yandex database

**Problem:** `getDb()` without an argument selects the `yandex-seo` cache key and legacy path; named lookup invokes package config (`packages/core/src/db/connection.ts:25-30`, `packages/core/src/db/connection.ts:44-60`).

**Risk:** A new workspace can write to the Yandex database when it omits its package name.

**Workaround:** Pass the explicit package name when the intended database is workspace-specific.

## Low

### Output redaction is pattern-based

**Problem:** `sanitizeForOutput` redacts a defined set of token and secret forms using regular expressions (`packages/core/src/errors.ts:68-78`).

**Risk:** A secret in an unrecognized field or format can remain in error text.

**Workaround:** Avoid placing raw credentials in values passed to `errorToMcpContent` or `safeLogUrl`.

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](overview.md)

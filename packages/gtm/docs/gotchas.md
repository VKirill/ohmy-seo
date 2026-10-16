---
title: GTM workspace gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [gtm, gotchas, documentation-drift]
sources:
  - packages/gtm/src/index.ts
  - packages/gtm/src/tools/complete-google-oauth-flow.ts
  - packages/gtm/src/tools/gtm-rollback.ts
  - packages/gtm/src/lib/etag-cache.ts
  - packages/core/src/db/migrations.ts
  - packages/gtm/src/tools/start-google-oauth-flow.ts
  - packages/gtm/src/tools/register-google-service-account.ts
---
# GTM workspace gotchas

TL;DR: The sharp edges include absent cache-management commands, a deprecated OAuth completion command, and rollback plans consumed before post-claim checks finish (`packages/gtm/src/index.ts:93-130`, `packages/gtm/src/tools/complete-google-oauth-flow.ts:1-19`, `packages/gtm/src/tools/gtm-rollback.ts:100-149`).

## Critical

### Rollback plans are single-use even when execution later fails

**Problem:** Execution deletes and claims a valid plan before comparing the caller's inputs, checking the live fingerprint, or publishing (`packages/gtm/src/tools/gtm-rollback.ts:107-149`).

**Risk:** An input mismatch, concurrent live edit, or failed publish consumes that plan; the operator must create another preview.

**Workaround:** Preserve the preview arguments and re-run preview after any failed execution.

### OAuth completion command is registered but nonfunctional

**Problem:** `complete_google_oauth_flow` returns an error for every invocation and directs callers to loopback OAuth (`packages/gtm/src/tools/complete-google-oauth-flow.ts:1-19`, `packages/gtm/src/index.ts:234-256`).

**Risk:** Clients following the old code/state workflow cannot connect an account through this tool.

**Workaround:** Use `start_google_oauth_flow`, which opens a browser authorization URL and waits for the loopback callback (`packages/gtm/src/tools/start-google-oauth-flow.ts:30-56`).

## High

### Cache management commands are not registered

**Problem:** The server registers credential tools, GTM reads, writes, and live/destructive operations, but no cache invalidation or cache statistics command (`packages/gtm/src/index.ts:132-1047`).

**Risk:** An MCP caller cannot invoke cache management through this server.

**Workaround:** Use the registered names in [the API reference](api.md).

### Version reads use a five-minute cache

**Problem:** `gtm_list_versions` and `gtm_get_version` use `MCP_GTM_CACHE_TTL_VERSIONS`, whose registered default is 300 seconds (`packages/gtm/src/index.ts:121-128`).

**Risk:** Cached version results can be stale within that configured window.

**Workaround:** Use the version cache policy in [the API reference](api.md) when reasoning about freshness.

## Medium

### Service-account registration is a separate credential path

**Problem:** `register_google_service_account` accepts a key-file path and requested scopes, verifies the key by obtaining a token, and stores it as a service-account identity (`packages/gtm/src/index.ts:288-300`, `packages/gtm/src/tools/register-google-service-account.ts:18-52`).

**Risk:** An operator following the OAuth client flow alone will not configure service-account credentials.

**Workaround:** Follow the service-account path in [accounts and Google authorization](features/accounts-and-oauth.md).

### Expired rollback plans have no scheduled purge

**Problem:** The migration defines an expiry index, but GTM execution deletes a plan only when that specific plan ID is submitted while still unexpired (`packages/core/src/db/migrations.ts:177-190`, `packages/gtm/src/tools/gtm-rollback.ts:107-118`).

**Risk:** Expired, unused plan rows remain in the SQLite table.

**Workaround:** Treat expiry as an execution validity check, not as automatic retention cleanup; table lifecycle details are in [the data model](data-model/credentials-and-rollback.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Tag Manager workspace overview](overview.md)

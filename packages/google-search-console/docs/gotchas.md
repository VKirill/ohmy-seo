---
title: Google Search Console workspace gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, gotchas, mcp]
sources:
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/lib/account-resolver.ts
  - packages/google-search-console/src/tools/gsc-search-analytics.ts
  - packages/google-search-console/src/tools/gsc-url-inspection.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/google-search-console/src/tools/register-google-oauth-app.ts
  - packages/google-search-console/src/tools/start-google-oauth-flow.ts
---
# Google Search Console workspace gotchas

TL;DR: Some cache-related names are not registered as MCP tools, account selection errors can be misleading, and read tools return some Google failures as ordinary result data (`packages/google-search-console/src/index.ts:118-438`, `packages/google-search-console/src/lib/account-resolver.ts:13-20`, `packages/google-search-console/src/lib/gsc-client.ts:100-118`).

## Critical

No critical code-specific trap was found in the inspected package.

## High

### Cache management names are not registered as tools

**Problem:** The MCP server registers account-management and GSC API tools, but does not register `gsc_invalidate_cache` or `gsc_cache_stats` (`packages/google-search-console/src/index.ts:118-438`).

**Risk:** Clients following the README may call tool names that this server does not expose.

**Workaround:** Use the registered tool list in [api.md](api.md) as the workspace API reference; cache configuration is described in [Search Analytics](features/search-analytics.md).

### Missing account and ambiguous account share the same error

**Problem:** When no explicit label is supplied and `getDefaultAccount` returns null, the resolver throws `AmbiguousAccountError`, whose message says multiple accounts were found. This also occurs when the account table is empty (`packages/google-search-console/src/lib/account-resolver.ts:13-20`, `packages/google-search-console/src/lib/account-resolver.ts:53-56`).

**Risk:** A client cannot distinguish “no account configured” from “multiple accounts without a default” from the message.

**Workaround:** Call `list_google_accounts`; connect an account if the list is empty, or set a default if it contains accounts.

## Medium

### Read-side Google API failures are returned as payload data

**Problem:** The shared HTTP client returns classified auth/API errors with `ok:false`, while Search Analytics returns `result.data` and URL inspection also returns `result.data` without checking `ok` (`packages/google-search-console/src/lib/gsc-client.ts:100-118`, `packages/google-search-console/src/tools/gsc-search-analytics.ts:79-91`, `packages/google-search-console/src/tools/gsc-url-inspection.ts:71-80`).

**Risk:** Callers may parse an error object as if it were an analytics or inspection response.

**Workaround:** Inspect the returned structure for the classified `error` field before interpreting a read result.

### OAuth app redirect URI is not enforced as described

**Problem:** The MCP description says the redirect URI must be loopback, but registration only rejects the OOB URI and otherwise stores the supplied value; the OAuth start flow uses the callback URI returned by its listener (`packages/google-search-console/src/index.ts:137-148`, `packages/google-search-console/src/tools/register-google-oauth-app.ts:13-31`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:34-42`).

**Risk:** A supplied redirect value may be persisted but not used by the flow, and a non-loopback URI passes the current local check.

**Workaround:** Register the same loopback callback configured in the Google OAuth client and rely on the active listener's callback during the flow.

## Low

No low-severity naming or tooling trap was found in the inspected package.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console workspace overview](overview.md)

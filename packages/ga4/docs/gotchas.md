---
title: GA4 workspace gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [ga4, pitfalls, oauth]
sources:
  - packages/ga4/src/index.ts
  - packages/ga4/src/tools/complete-google-oauth-flow.ts
  - packages/ga4/src/tools/start-google-oauth-flow.ts
  - packages/ga4/src/tools/ga4-run-realtime-report.ts
  - packages/ga4/src/tools/ga4-update-data-retention.ts
  - packages/ga4/src/lib/db/oauth-apps-repo.ts
  - packages/ga4/src/tools/delete-google-oauth-app.ts
---

# GA4 workspace gotchas

TL;DR: One OAuth command is a stub, the loopback callback ignores the stored redirect URI, realtime calls bypass cache, and retention writes have no paired read.

## Critical

### Realtime reports bypass cache

**Problem:** Realtime tool calls execute directly; the cache registry covers standard, batch, and pivot reports only.

**Risk:** Repeated realtime calls reach Google and consume quota.

**Workaround:** Treat every realtime request as a live API call (packages/ga4/src/index.ts:40-50, packages/ga4/src/tools/ga4-run-realtime-report.ts:26-50).

## High

### Deprecated OAuth completion remains registered

**Problem:** complete_google_oauth_flow is registered but always returns a deprecation error.

**Risk:** A caller can select an exposed command that cannot complete authentication.

**Workaround:** Use start_google_oauth_flow (packages/ga4/src/index.ts:146-155, packages/ga4/src/tools/complete-google-oauth-flow.ts:6-20).

### Stored redirect URI does not drive the callback

**Problem:** Registration stores redirect_uri, while the OAuth flow starts a listener and passes its callbackUrl to Google (packages/ga4/src/lib/db/oauth-apps-repo.ts:57-65, packages/ga4/src/tools/start-google-oauth-flow.ts:30-42).

**Risk:** Changing the stored URI alone does not select the running listener's callback port.

**Workaround:** Configure MCP_GA4_OAUTH_LOOPBACK_PORT and register the matching loopback callback with Google (packages/ga4/src/tools/start-google-oauth-flow.ts:30-42).

## Medium

### Retention writes have no paired read

**Problem:** The package has a retention update command but no read tool; the implementation has no corresponding cache to invalidate (packages/ga4/src/tools/ga4-update-data-retention.ts:39-40, packages/ga4/src/tools/ga4-update-data-retention.ts:78-95).

**Risk:** The update result does not include a follow-up read from this package.

**Workaround:** Inspect the returned response or read the setting through another GA4 Admin API client (packages/ga4/src/tools/ga4-update-data-retention.ts:88-95).

### OAuth app deletion is blocked by attached accounts

**Problem:** The repository checks google_accounts and rejects app deletion when any account refers to it.

**Risk:** Deleting the app first fails and leaves it stored.

**Workaround:** Delete attached accounts, then retry app deletion (packages/ga4/src/lib/db/oauth-apps-repo.ts:118-142, packages/ga4/src/tools/delete-google-oauth-app.ts:25-34).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Analytics 4 workspace overview](overview.md)

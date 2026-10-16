---
title: Yandex SEO workspace gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, gotchas, integration]
sources:
  - packages/yandex-seo/src/registry/_shared.ts
  - packages/yandex-seo/src/registry/gateways.ts
  - packages/yandex-seo/src/registry/inventory.ts
  - packages/yandex-seo/scripts/bundle-recovery.ts
  - packages/yandex-seo/src/lib/api-gateway.ts
  - packages/yandex-seo/src/lib/api/confirm-gate.ts
  - packages/yandex-seo/src/registry/direct-bundle.ts
  - packages/yandex-seo/src/lib/inventory/cache-policy.ts
  - packages/yandex-seo/src/lib/bundle-ledger.ts
  - packages/yandex-seo/src/index.ts
---
# Yandex SEO workspace gotchas

TL;DR: The main integration traps are exact Direct ID representation, multiple live-write gates, stale inventory returned during background refresh, and durable recovery state for bundle operations (`packages/yandex-seo/src/lib/api-gateway.ts:59-78`, `packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).

## Critical

### Large Direct IDs must stay strings

**Problem:** A 19-digit Direct ID passed as a JSON number can be rounded by JavaScript before this package receives it; the gateway rejects unsafe integer numbers, but cannot restore lost digits (`packages/yandex-seo/src/lib/api-gateway.ts:59-78`).
**Risk:** A read or mutation can target a different ID or fail due to an altered ID.
**Workaround:** Pass large IDs as quoted strings of digits, including inside object and array bodies (`packages/yandex-seo/src/lib/api-gateway.ts:46-56,59-78`).

## High

### Live mutation requires multiple independent confirmations

**Problem:** `confirm: true` alone does not enable a Direct write; global and Direct-specific environment flags and exact acknowledgement text are also required (`packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).
**Risk:** A request stops before the API call when any live gate requirement is missing.
**Workaround:** For bundle stages, use the acknowledgement emitted by the dry run and preserve its exact login and plan-hash prefix; see [Campaign bundles](features/campaign-bundles.md) (`packages/yandex-seo/src/registry/direct-bundle.ts:127-155`).

### Stale inventory is returned before refresh completes

**Problem:** After the inventory TTL expires, list calls return the cached rows immediately and start refresh in the background (`packages/yandex-seo/src/lib/inventory/cache-policy.ts:47-64,73-90`).
**Risk:** The returned property list can omit newly added sites or counters until a later call.
**Workaround:** Call `refresh_inventory` when the caller needs an explicit refresh report and wait for that call to complete (`packages/yandex-seo/src/registry/inventory.ts:79-97`).

## Medium

### Generic API tools are marked read-only in MCP metadata

**Problem:** The generic gateways accept POST, PUT, and DELETE methods, while their shared MCP annotation sets `readOnlyHint: true` (`packages/yandex-seo/src/registry/_shared.ts:3-11`, `packages/yandex-seo/src/registry/gateways.ts:8-87`).
**Risk:** A client that trusts tool annotations can treat a write-capable gateway as read-only.
**Workaround:** Treat method and endpoint inputs as write-capable and apply the API's own change review before sending a non-GET request (`packages/yandex-seo/src/lib/api-gateway.ts:134-142`).

### A crash can leave pending bundle ledger records

**Problem:** Bundle operations append `pending` before external creation and append `committed` or `failed` afterward; a process crash can leave unresolved pending records (`packages/yandex-seo/src/lib/bundle-ledger.ts:27-75`).
**Risk:** Re-running blindly can duplicate entities whose API response was lost after the remote side committed.
**Workaround:** Inspect unresolved ledger entries with the recovery script before retrying the same bundle (`packages/yandex-seo/scripts/bundle-recovery.ts:1-100`).

### Master-key failure happens before MCP starts

**Problem:** Startup validates the encryption master key before connecting the stdio transport and exits on failure (`packages/yandex-seo/src/index.ts:39-45,57-66`).
**Risk:** The MCP client sees a process that exits without serving tools.
**Workaround:** Set a valid `MCP_YANDEX_SEO_MASTER_KEY` in the process environment before launching the server (`packages/yandex-seo/src/index.ts:2-5,39-45`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex SEO workspace overview](overview.md)

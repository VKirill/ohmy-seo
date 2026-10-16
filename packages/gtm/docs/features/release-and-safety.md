---
title: GTM publishing, rollback, and destructive actions
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [gtm, publishing, rollback, safety]
sources:
  - packages/gtm/src/tools/gtm-publish-version.ts
  - packages/gtm/src/tools/gtm-rollback.ts
  - packages/gtm/src/tools/gtm-delete-container.ts
  - packages/gtm/src/tools/gtm-delete-user-permission.ts
  - packages/gtm/src/lib/confirm-gate.ts
  - packages/core/src/db/migrations.ts
  - packages/gtm/src/index.ts
  - packages/gtm/package.json
  - packages/gtm/src/lib/gtm-client.ts
---
# GTM publishing, rollback, and destructive actions

TL;DR: Live publication, rollback, container deletion, and permission revocation require `confirm:true` plus a target-specific `acknowledge_live` string; rollback also requires a fresh stored plan (`packages/gtm/src/tools/gtm-publish-version.ts:63-97`, `packages/gtm/src/tools/gtm-rollback.ts:49-116`).

## Purpose

These four tools affect a live container or remove GTM access. They show a preview before execution, and their handlers enforce an acknowledgement that echoes the target identifier (`packages/gtm/src/index.ts:926-1047`, `packages/gtm/src/lib/confirm-gate.ts:44-65`).

## How it works

1. Call the dangerous tool with `confirm:false` or omit `confirm`; it returns a preview and does not perform the requested live change (`packages/gtm/src/tools/gtm-publish-version.ts:63-78`, `packages/gtm/src/tools/gtm-delete-container.ts:54-71`).
2. For publish or destructive deletion, repeat with `confirm:true` and `acknowledge_live` equal to `I-UNDERSTAND-THIS-IS-LIVE:<target-id>` (`packages/gtm/src/lib/confirm-gate.ts:44-65`, `packages/gtm/src/tools/gtm-delete-user-permission.ts:64-84`).
3. Publish resolves a Google identity with the publish scope and posts to the selected version's `:publish` endpoint (`packages/gtm/src/tools/gtm-publish-version.ts:80-99`).
4. Rollback preview reads the live version and target version, stores a plan with current fingerprint and a five-minute expiration, and returns `plan_id` (`packages/gtm/src/tools/gtm-rollback.ts:49-97`).
5. Rollback execution checks the acknowledgement, atomically deletes and claims a non-expired plan, checks that account/container/workspace/version inputs match, and re-reads live state (`packages/gtm/src/tools/gtm-rollback.ts:100-141`).
6. If the fingerprint still matches, rollback publishes the selected old version as the new live version; it does not create a copy of the old version (`packages/gtm/src/tools/gtm-rollback.ts:143-158`).
7. Container deletion removes the container and its contents; permission deletion revokes access. Both call the relevant DELETE endpoint after the gate (`packages/gtm/src/tools/gtm-delete-container.ts:75-102`, `packages/gtm/src/tools/gtm-delete-user-permission.ts:75-95`).

### Modes

| Tool | Preview and execution inputs | Effect | Failure behavior |
|---|---|---|---|
| `gtm_publish_version` | Preview uses account/container/version IDs; execution additionally requires `confirm:true` and exact acknowledgement of version ID (`packages/gtm/src/tools/gtm-publish-version.ts:21-52`) | Makes the selected version live (`packages/gtm/src/tools/gtm-publish-version.ts:87-99`) | Scope or acknowledgement error stops before POST; API result is returned (`packages/gtm/src/tools/gtm-publish-version.ts:80-99`) |
| `gtm_rollback` | Preview accepts hierarchy IDs and target version; execution needs `plan_id`, `confirm:true`, and acknowledgement of container ID (`packages/gtm/src/tools/gtm-rollback.ts:20-33`) | Publishes an existing version as live after a five-minute check (`packages/gtm/src/tools/gtm-rollback.ts:71-97`, `packages/gtm/src/tools/gtm-rollback.ts:143-149`) | Missing/expired plan, input mismatch, changed fingerprint, or failed publish stops the operation (`packages/gtm/src/tools/gtm-rollback.ts:103-149`) |
| `gtm_delete_container` | Container ID; execution additionally requires `confirm:true` and matching acknowledgement (`packages/gtm/src/tools/gtm-delete-container.ts:22-48`) | Permanently deletes a GTM container and its nested entities (`packages/gtm/src/tools/gtm-delete-container.ts:72-102`) | Confirmation gate or Google API failure returns an error result (`packages/gtm/src/tools/gtm-delete-container.ts:72-105`) |
| `gtm_delete_user_permission` | Permission ID; execution additionally requires `confirm:true` and matching acknowledgement (`packages/gtm/src/tools/gtm-delete-user-permission.ts:22-50`) | Revokes the selected user's GTM access (`packages/gtm/src/tools/gtm-delete-user-permission.ts:64-95`) | Confirmation gate or Google API failure returns an error result (`packages/gtm/src/tools/gtm-delete-user-permission.ts:64-106`) |

## Business rules

- `confirm` must be literal `true`; omitted and false values remain preview paths (`packages/gtm/src/lib/confirm-gate.ts:29-43`).
- `acknowledge_live.trim()` must exactly equal the required target-specific phrase (`packages/gtm/src/lib/confirm-gate.ts:44-65`).
- Rollback plan expiry is 300,000 milliseconds; expiry is stored as Unix seconds (`packages/gtm/src/tools/gtm-rollback.ts:8-10`, `packages/gtm/src/tools/gtm-rollback.ts:71-84`).
- Rollback plans are single-use because execution uses `DELETE ... RETURNING` to claim a matching unexpired row (`packages/gtm/src/tools/gtm-rollback.ts:107-118`).
- The rollback plan pins the Google account, GTM account, container, workspace, source version, target version, and preview fingerprint; execution checks matching caller inputs and live fingerprint (`packages/gtm/src/tools/gtm-rollback.ts:76-84`, `packages/gtm/src/tools/gtm-rollback.ts:121-141`).
- Failure after the atomic plan claim consumes the plan. A fresh preview is required after an input mismatch, changed fingerprint, or publish failure (`packages/gtm/src/tools/gtm-rollback.ts:107-149`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `gtm_publish_version` | `packages/gtm/src/index.ts:926-956` | Publish a version as live |
| `gtm_rollback` | `packages/gtm/src/index.ts:958-992` | Preview and execute a guarded rollback |
| `gtm_delete_container` | `packages/gtm/src/index.ts:994-1022` | Delete a container |
| `gtm_delete_user_permission` | `packages/gtm/src/index.ts:1024-1047` | Revoke user permissions |

## Package shape

Each action has an individual handler in `packages/gtm/src/tools/`; shared confirmation helpers are in `packages/gtm/src/lib/confirm-gate.ts`, and rollback-plan table creation is in `packages/core/src/db/migrations.ts:177-190`.

## Internal model

Publish and delete actions use a stateless two-step confirmation: the preview is returned to the caller, and the execute call validates the target-specific text. Rollback adds a database plan so the execution call can verify the same target and live fingerprint selected in preview (`packages/gtm/src/lib/confirm-gate.ts:44-65`, `packages/gtm/src/tools/gtm-rollback.ts:71-141`).

## Dependencies

The handlers use `@ohmy-seo/mcp-core` for Google OAuth scopes, SQLite, and error handling; the GTM request wrapper performs the API calls (`packages/gtm/package.json:18-22`, `packages/gtm/src/tools/gtm-rollback.ts:1-6`, `packages/gtm/src/lib/gtm-client.ts:95-154`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [GTM MCP tool API](../api.md)
- [Google Tag Manager workspace overview](../overview.md)

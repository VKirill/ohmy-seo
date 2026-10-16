---
title: GTM resource reads and edits
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [gtm, tags, workspaces, resources]
sources:
  - packages/gtm/src/index.ts
  - packages/gtm/src/lib/gtm-client.ts
  - packages/gtm/src/lib/etag-cache.ts
  - packages/gtm/src/lib/confirm-gate.ts
  - packages/gtm/src/tools/gtm-create-tag.ts
  - packages/gtm/src/tools/gtm-update-tag.ts
  - packages/gtm/src/tools/gtm-delete-tag.ts
  - packages/gtm/src/tools/gtm-update-account.ts
  - packages/gtm/src/lib/account-resolver.ts
  - packages/gtm/src/tools/gtm-list-user-permissions.ts
  - packages/gtm/package.json
---
# GTM resource reads and edits

TL;DR: This capability reads GTM accounts, containers, workspaces, tags, triggers, variables, and versions, and creates or updates editable resources through confirmed API calls (`packages/gtm/src/index.ts:300-925`).

## Purpose

The tool set provides read access to the GTM hierarchy and draft editing operations. Reads return API data; writes either return a dry-run preview or call the GTM API after confirmation (`packages/gtm/src/index.ts:300-925`, `packages/gtm/src/lib/confirm-gate.ts:29-91`).

## How it works

1. MCP validates tool arguments against the registered Zod shape, including account/container/workspace IDs and operation-specific fields (`packages/gtm/src/index.ts:343-514`, `packages/gtm/src/index.ts:540-925`).
2. A read handler resolves the chosen Google account (explicit `account` label or default), checks the operation's OAuth scope, then builds the GTM API path (`packages/gtm/src/lib/account-resolver.ts:30-57`, `packages/gtm/src/tools/gtm-list-user-permissions.ts:35-44`).
3. The GTM client obtains an access token from the core token broker and sends a JSON request to the Tag Manager API v2 (`packages/gtm/src/lib/gtm-client.ts:17-18`, `packages/gtm/src/lib/gtm-client.ts:95-132`).
4. A successful GET caches a resource fingerprint from the response body, falling back to the HTTP ETag header (`packages/gtm/src/lib/gtm-client.ts:160-164`, `packages/gtm/src/lib/gtm-client.ts:194-213`).
5. A write with `confirm:false` returns a preview without calling Google; confirmed writes resolve credentials and invoke the relevant API method (`packages/gtm/src/tools/gtm-create-tag.ts:106-125`, `packages/gtm/src/tools/gtm-update-tag.ts:59-82`).
6. Update and delete operations that need concurrency protection read the exact resource first, then send the cached token in `If-Match`. A 412 becomes `EtagConflictError`; a missing token becomes `MissingEtagError` (`packages/gtm/src/lib/gtm-client.ts:36-49`, `packages/gtm/src/lib/gtm-client.ts:138-139`, `packages/gtm/src/lib/gtm-client.ts:95-119`).
7. Successful writes invalidate cached GTM query results for that Google account; cache invalidation is best-effort and cannot mask the completed write (`packages/gtm/src/lib/gtm-client.ts:166-175`).

### Modes

| Operation | Input/output difference | Access and confirmation | Failure behavior |
|---|---|---|---|
| Read hierarchy/resources | Account list, containers, workspaces, tags, triggers, variables, version headers, or one version | Requires resource-specific Google scope; account label is optional if a default exists (`packages/gtm/src/index.ts:343-513`) | Account resolution, scope, token, network, and non-success HTTP outcomes are returned or raised through the handler error path (`packages/gtm/src/lib/account-resolver.ts:37-55`, `packages/gtm/src/lib/gtm-client.ts:128-162`) |
| Create | Workspace, tag, trigger, variable, version, or container payload | `confirm:true`; tag/trigger/variable edits use `tagmanager.edit.containers`, account/container management uses narrower account scope as registered by handlers (`packages/gtm/src/index.ts:540-839`) | Missing confirmation returns a preview; scope/API failures return MCP error content (`packages/gtm/src/tools/gtm-create-tag.ts:106-142`) |
| Update | Tag or account fields | `confirm:true`; tag update reads the resource and preserves unspecified fields; account update reads the full account before PUT (`packages/gtm/src/tools/gtm-update-tag.ts:68-82`, `packages/gtm/src/tools/gtm-update-account.ts:65-96`) | Read failure stops the update; missing or stale fingerprint blocks the write (`packages/gtm/src/tools/gtm-update-account.ts:77-79`, `packages/gtm/src/lib/gtm-client.ts:36-49`, `packages/gtm/src/lib/gtm-client.ts:138-139`) |
| Delete tag | Tag ID and workspace hierarchy | `confirm:true`; handler first fetches the exact tag to get its fingerprint (`packages/gtm/src/tools/gtm-delete-tag.ts:70-86`) | Read failure returns immediately; missing fingerprint gives an instruction to read the tag first (`packages/gtm/src/tools/gtm-delete-tag.ts:74-78`, `packages/gtm/src/tools/gtm-delete-tag.ts:96-108`) |

## Business rules

- Write confirmations default to false; the common guard accepts only literal `true` (`packages/gtm/src/lib/confirm-gate.ts:29-43`, `packages/gtm/src/lib/confirm-gate.ts:93-97`).
- Update-tag is a full-resource PUT: the current tag is read and merged with supplied fields so omitted fields remain in the outgoing body (`packages/gtm/src/tools/gtm-update-tag.ts:72-81`).
- Update-account performs a GET then PUT with unchanged `name` and `shareData` fields preserved when omitted (`packages/gtm/src/tools/gtm-update-account.ts:69-95`).
- A fingerprint is stored by exact GTM API path for five minutes; writes requiring ETag fail if the path has no current cached value (`packages/gtm/src/lib/etag-cache.ts:8-10`, `packages/gtm/src/lib/etag-cache.ts:22-47`, `packages/gtm/src/lib/gtm-client.ts:95-119`).
- HTTP 412 signals a concurrent edit and is raised as `EtagConflictError` (`packages/gtm/src/lib/gtm-client.ts:138-139`).
- Read-cache TTLs and the uncached permission-list exception are owned by the [API reference](../api.md) (`packages/gtm/src/index.ts:93-130`).

## Public API

| MCP tools | Registration | Purpose |
|---|---|---|
| `gtm_list_accounts`, `gtm_list_containers`, `gtm_list_workspaces` | `packages/gtm/src/index.ts:343-390` | Traverse account and container hierarchy |
| `gtm_list_tags`, `gtm_list_triggers`, `gtm_list_variables` | `packages/gtm/src/index.ts:392-462` | Inspect workspace resources |
| `gtm_list_versions`, `gtm_get_version` | `packages/gtm/src/index.ts:464-511` | Inspect version headers and full version |
| `gtm_create_workspace`, `gtm_create_tag`, `gtm_create_trigger`, `gtm_create_variable` | `packages/gtm/src/index.ts:540-672` | Create workspace resources |
| `gtm_update_tag`, `gtm_delete_tag` | `packages/gtm/src/index.ts:674-746` | Modify or remove a tag |
| `gtm_create_version`, `gtm_create_container`, `gtm_update_account` | `packages/gtm/src/index.ts:748-838` | Create version/container or update account metadata |
| `gtm_list_user_permissions` | `packages/gtm/src/index.ts:514-538` | Read GTM account permissions without result caching |

## Package shape

Handlers live in `packages/gtm/src/tools/`; common API and concurrency behavior is in `packages/gtm/src/lib/gtm-client.ts` and `packages/gtm/src/lib/etag-cache.ts` (`packages/gtm/src/index.ts:17-55`).

## Internal model

Each tool handler supplies a scope, HTTP method, resource path, and optional body to `executeGtmCall`. The client owns token acquisition, request serialization, response parsing, fingerprint caching, precondition headers, and cache invalidation (`packages/gtm/src/lib/gtm-client.ts:95-175`).

## Dependencies

The capability depends on `@ohmy-seo/mcp-core` OAuth, query-cache, and error helpers; the workspace uses Zod for input schemas (`packages/gtm/package.json:18-22`, `packages/gtm/src/lib/gtm-client.ts:10-15`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [GTM MCP tool API](../api.md)
- [Google Tag Manager workspace overview](../overview.md)

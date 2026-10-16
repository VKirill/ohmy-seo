---
title: GTM MCP tool API
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: low
tags: [gtm, mcp, api-reference]
sources:
  - packages/gtm/src/index.ts
  - packages/gtm/src/lib/account-resolver.ts
  - packages/gtm/src/lib/confirm-gate.ts
  - packages/gtm/src/tools/gtm-rollback.ts
  - packages/gtm/src/tools/gtm-publish-version.ts
  - packages/gtm/src/tools/gtm-list-user-permissions.ts
  - packages/core/src/google-oauth/scopes.ts
  - packages/gtm/src/tools/gtm-update-account.ts
  - packages/gtm/src/lib/gtm-client.ts
  - packages/core/src/config/package-config.ts
---
# GTM MCP tool API

TL;DR: `mcp-gtm` exposes 33 MCP tools over stdio; clients call each registered tool by name with a JSON argument object, and GTM operations require a Google account with the tool's OAuth scope (`packages/gtm/src/index.ts:63-80`, `packages/gtm/src/lib/account-resolver.ts:30-57`).

## Purpose

This is an MCP command API, not an HTTP server API. The package registers named tools on `McpServer`, then connects that server to `StdioServerTransport` (`packages/gtm/src/index.ts:63-64`, `packages/gtm/src/index.ts:1057-1067`). The registered input schemas and descriptions define each command's parameters (`packages/gtm/src/index.ts:136-300`, `packages/gtm/src/index.ts:343-1047`).

## How it works

1. The MCP client discovers tool names and schemas through the MCP server (`packages/gtm/src/index.ts:63-80`).
2. The client calls a tool by name and supplies its JSON arguments (`packages/gtm/src/index.ts:136-300`, `packages/gtm/src/index.ts:343-1047`).
3. Credential tools use the local database; GTM tools resolve the named or default account, enforce scopes in their handlers, and call the Google API (`packages/gtm/src/lib/account-resolver.ts:30-57`, `packages/gtm/src/lib/gtm-client.ts:95-119`).
4. Write tools return previews until `confirm:true`; destructive/live commands add an exact target acknowledgement (`packages/gtm/src/lib/confirm-gate.ts:29-65`).

### Modes

| Command class | Calls and inputs | Authentication | Result/error behavior |
|---|---|---|---|
| Credential administration | OAuth app and Google account labels, OAuth client fields, loopback callback, or service-account key path (`packages/gtm/src/index.ts:136-300`) | Local MCP process and package master key; OAuth operations do not call GTM endpoints (`packages/gtm/src/index.ts:84-90`) | Account/app records or formatted MCP errors |
| GTM reads | Resource IDs and optional `account` label (`packages/gtm/src/index.ts:343-538`) | Selected/default identity must include the handler's required scope (`packages/gtm/src/lib/account-resolver.ts:37-55`) | GTM API data; one user-permissions read bypasses cache (`packages/gtm/src/index.ts:129-130`) |
| GTM writes | Resource IDs, changed fields, and `confirm` (`packages/gtm/src/index.ts:540-925`) | Selected/default identity and operation-specific scope | `confirm:false` previews; `confirm:true` calls Google (`packages/gtm/src/lib/confirm-gate.ts:29-43`) |
| Live/destructive actions | Target IDs, confirmation, and target-specific acknowledgement (`packages/gtm/src/index.ts:926-1047`) | Selected/default identity and publish/manage scope | Preview or guarded live operation; rollback additionally requires `plan_id` (`packages/gtm/src/tools/gtm-rollback.ts:100-149`) |

## Authentication and invocation

The package uses stdio transport; it does not define an HTTP route or HTTP authentication scheme (`packages/gtm/src/index.ts:1057-1067`). Startup validates `MCP_GTM_MASTER_KEY` through `resolvePackageConfig("gtm")` (`packages/gtm/src/index.ts:84-90`, `packages/core/src/config/package-config.ts:37-59`). GTM calls select an explicit account label or the stored default and check that `scopes_granted` contains the exact required scope (`packages/gtm/src/lib/account-resolver.ts:30-55`).

The shared tool input field `account` selects a connected identity; omitting it selects the default account. Required GTM scopes are listed per command below and checked against `scopes_granted`; scope constants map to Google scope URLs in `packages/core/src/google-oauth/scopes.ts:15-22`. A write's `confirm` field defaults to `false` (`packages/gtm/src/index.ts:343-389`, `packages/gtm/src/lib/account-resolver.ts:49-55`, `packages/gtm/src/lib/confirm-gate.ts:93-103`).

## Credential and account tools

Caller: an MCP client with access to the local `mcp-gtm` process. These commands manage local credentials or identity selection.

| Tool | Method / path | Required and optional arguments | Effect | Auth | Registration |
|---|---|---|---|---|---|
| `list_google_oauth_apps` | MCP tool call | None | Lists OAuth app metadata; local database | Local database access; package master key | `packages/gtm/src/index.ts:136-150` |
| `register_google_oauth_app` | MCP tool call | `label`, `client_id`, `client_secret`, `scopes_declared`, `redirect_uri` | Stores OAuth app; client secret encrypted | Local database access; package master key | `packages/gtm/src/index.ts:152-179` |
| `delete_google_oauth_app` | MCP tool call | `app_label` | Deletes app only when no account references it | Local database access; package master key | `packages/gtm/src/index.ts:181-194` |
| `list_google_accounts` | MCP tool call | None | Lists account metadata without tokens | Local database access; package master key | `packages/gtm/src/index.ts:196-208` |
| `start_google_oauth_flow` | MCP tool call | `app_label`, `account_label`; optional `login_hint` | Opens loopback authorization and stores granted identity | Google OAuth consent for declared app scopes; package master key | `packages/gtm/src/index.ts:210-232` |
| `complete_google_oauth_flow` | MCP tool call | `app_label`, `account_label`, `code`, `state` | Deprecated; returns an error directing callers to loopback flow | Always rejected; use loopback OAuth | `packages/gtm/src/index.ts:234-256` |
| `delete_google_account` | MCP tool call | `account_label` | Deletes local credential record; does not revoke at Google | Local database access; package master key | `packages/gtm/src/index.ts:258-271` |
| `set_default_google_account` | MCP tool call | `account_label` | Selects default identity for calls without `account` | Local database access; package master key | `packages/gtm/src/index.ts:273-286` |
| `register_google_service_account` | MCP tool call | `account_label`, `json_path`, `scopes` | Validates JSON key by obtaining a token, then stores identity | Google token validation for requested scopes; package master key | `packages/gtm/src/index.ts:288-300` |

Details and failure paths: [accounts and Google authorization](features/accounts-and-oauth.md).

## GTM read tools

Caller: an MCP client. All commands accept optional `account`; required Google scopes are enforced by each handler before its GTM API call (`packages/gtm/src/lib/account-resolver.ts:30-55`).

| Tool | Required resource arguments | Purpose and cache | Auth | Registration |
|---|---|---|---|---|
| `gtm_list_accounts` | None | List accessible accounts; account read scope; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:343-354` |
| `gtm_list_containers` | `accountId` | List account containers; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:356-368` |
| `gtm_list_workspaces` | `accountId`, `containerId` | List container workspaces; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:370-390` |
| `gtm_list_tags` | `accountId`, `containerId`, `workspaceId` | List workspace tags; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:392-414` |
| `gtm_list_triggers` | `accountId`, `containerId`, `workspaceId` | List workspace triggers; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:416-438` |
| `gtm_list_variables` | `accountId`, `containerId`, `workspaceId` | List workspace variables; cacheable | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:440-462` |
| `gtm_list_versions` | `accountId`, `containerId` | List version headers; cacheable with version TTL | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:464-484` |
| `gtm_get_version` | `accountId`, `containerId`, `versionId` | Fetch full version; cacheable with version TTL | `SCOPE_GTM_READONLY` | `packages/gtm/src/index.ts:486-511` |
| `gtm_list_user_permissions` | `accountId` | List account and container grants; not cached | `SCOPE_GTM_MANAGE_USERS` | `packages/gtm/src/index.ts:514-538`, `packages/gtm/src/tools/gtm-list-user-permissions.ts:5-7` |

Cache defaults are 3600 seconds for account/container/workspace/tag/trigger/variable lists and 300 seconds for version reads; env overrides are `MCP_GTM_CACHE_TTL_READ` and `MCP_GTM_CACHE_TTL_VERSIONS` (`packages/gtm/src/index.ts:93-130`).

## GTM write tools

Caller: an MCP client. Each command below requires the named account's relevant Google permissions. All writes default to preview mode and require `confirm:true` for execution (`packages/gtm/src/lib/confirm-gate.ts:29-43`).

| Tool | Required resource arguments | What it changes | Auth | Registration |
|---|---|---|---|---|
| `gtm_create_workspace` | `accountId`, `containerId`, `name` | Creates workspace | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:540-566` |
| `gtm_create_tag` | `accountId`, `containerId`, `workspaceId`, `name`, `type` | Creates tag; optional parameters and firing/blocking triggers | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:568-604` |
| `gtm_create_trigger` | `accountId`, `containerId`, `workspaceId`, `name`, `type` | Creates trigger and optional condition fields | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:606-640` |
| `gtm_create_variable` | `accountId`, `containerId`, `workspaceId`, `name`, `type` | Creates variable | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:642-672` |
| `gtm_update_tag` | `accountId`, `containerId`, `workspaceId`, `tagId` | Updates supplied tag fields while retaining omitted fields | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:674-716` |
| `gtm_delete_tag` | `accountId`, `containerId`, `workspaceId`, `tagId` | Deletes tag after resource read for concurrency token | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:718-746` |
| `gtm_create_version` | `accountId`, `containerId`, `workspaceId`, `name` | Creates container version from workspace | `SCOPE_GTM_EDIT_VERSIONS` | `packages/gtm/src/index.ts:748-779` |
| `gtm_create_container` | `accountId`, `name`, `usageContext` | Creates container | `SCOPE_GTM_EDIT` | `packages/gtm/src/index.ts:781-809` |
| `gtm_update_account` | `accountId`; optional `name`, `shareData` | Reads and updates account metadata | `SCOPE_GTM_MANAGE_ACCOUNTS` | `packages/gtm/src/index.ts:811-838` |
| `gtm_create_user_permission` | `accountId`, `emailAddress`, `accountPermission`; optional `containerAccess` | Grants account/container permissions | `SCOPE_GTM_MANAGE_USERS` | `packages/gtm/src/index.ts:840-877` |
| `gtm_update_user_permission` | `accountId`, `permissionId`; optional email, account permission, container access | Replaces selected permission fields | `SCOPE_GTM_MANAGE_USERS` | `packages/gtm/src/index.ts:879-924` |

## Live and destructive tools

Caller: an MCP client. The acknowledgement must exactly match the operation target after trimming; see [publishing and safety behavior](features/release-and-safety.md) (`packages/gtm/src/lib/confirm-gate.ts:44-65`).

| Tool | Required resource arguments | Additional execution arguments | Effect | Auth | Registration |
|---|---|---|---|---|---|
| `gtm_publish_version` | `accountId`, `containerId`, `versionId` | `confirm:true`, `acknowledge_live:I-UNDERSTAND-THIS-IS-LIVE:<versionId>` | Publishes selected version | `SCOPE_GTM_PUBLISH` | `packages/gtm/src/index.ts:926-956` |
| `gtm_rollback` | `accountId`, `containerId`, `workspaceId`, `to_version_id` | Preview returns `plan_id`; execution adds it, `confirm:true`, and acknowledgement of `containerId` | Publishes target version after fingerprint recheck | `SCOPE_GTM_PUBLISH` | `packages/gtm/src/index.ts:958-992` |
| `gtm_delete_container` | `accountId`, `containerId` | `confirm:true`, acknowledgement of `containerId` | Deletes the container and its contents | `SCOPE_GTM_DELETE_CONTAINERS` | `packages/gtm/src/index.ts:994-1022` |
| `gtm_delete_user_permission` | `accountId`, `permissionId` | `confirm:true`, acknowledgement of `permissionId` | Revokes the permission | `SCOPE_GTM_MANAGE_USERS` | `packages/gtm/src/index.ts:1024-1047` |

## Business rules

- Google account resolution uses the explicit account label or stored default, then rejects missing identity or insufficient scope (`packages/gtm/src/lib/account-resolver.ts:30-55`).
- All ordinary writes require `confirm:true`; the default is false (`packages/gtm/src/lib/confirm-gate.ts:29-43`, `packages/gtm/src/lib/confirm-gate.ts:93-103`).
- Live/destructive operations require exact target-specific acknowledgement in addition to confirmation (`packages/gtm/src/lib/confirm-gate.ts:44-65`).
- Rollback execution also requires a valid, unexpired, single-use plan (`packages/gtm/src/tools/gtm-rollback.ts:100-124`).

## Failures

Input shape errors occur during MCP schema validation. Missing credentials, missing default account, and insufficient scope stop account resolution (`packages/gtm/src/index.ts:136-300`, `packages/gtm/src/lib/account-resolver.ts:37-55`). GTM API requests raise an ETag conflict for HTTP 412, while non-success responses retain their status/data for each tool's response path (`packages/gtm/src/lib/gtm-client.ts:128-162`). A rollback plan that expires, no longer matches the request, or references a changed live fingerprint is rejected and requires a fresh preview (`packages/gtm/src/tools/gtm-rollback.ts:103-149`).

## Related pages

- [Workspace overview](overview.md)
- [Accounts and Google authorization](features/accounts-and-oauth.md)
- [GTM resource reads and edits](features/gtm-resources.md)
- [Publishing, rollback, and destructive actions](features/release-and-safety.md)

<!-- lane-pilot:backlinks -->
## Referenced by

- [GTM resource reads and edits](features/gtm-resources.md)
- [GTM workspace gotchas](gotchas.md)
- [Google Tag Manager workspace overview](overview.md)

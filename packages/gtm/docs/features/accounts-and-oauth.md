---
title: GTM accounts and Google authorization
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: high
tags: [gtm, oauth, accounts, credentials]
sources:
  - packages/gtm/src/tools/start-google-oauth-flow.ts
  - packages/gtm/src/lib/db/accounts-repo.ts
  - packages/gtm/src/lib/db/oauth-apps-repo.ts
  - packages/gtm/src/lib/account-resolver.ts
  - packages/gtm/src/tools/register-google-service-account.ts
  - packages/gtm/src/index.ts
  - packages/core/src/google-oauth/token-broker.ts
  - packages/gtm/src/tools/register-google-oauth-app.ts
  - packages/gtm/src/tools/complete-google-oauth-flow.ts
  - packages/core/src/db/migrations.ts
  - packages/gtm/src/lib/gtm-client.ts
  - packages/gtm/package.json
---
# GTM accounts and Google authorization

TL;DR: This capability stores encrypted OAuth client credentials and Google user or service-account tokens, then resolves a selected or default account with the requested GTM scope before API calls (`packages/gtm/src/lib/db/oauth-apps-repo.ts:57-103`, `packages/gtm/src/lib/db/accounts-repo.ts:100-159`, `packages/gtm/src/lib/account-resolver.ts:30-57`).

## Purpose

The credential tools configure Google identities for the GTM API. OAuth client registrations and connected accounts are stored in the GTM package's SQLite database; public list results omit secrets (`packages/gtm/src/lib/db/oauth-apps-repo.ts:28-45`, `packages/gtm/src/lib/db/accounts-repo.ts:24-54`). The account resolver checks the required scope before returning credentials to a GTM operation (`packages/gtm/src/lib/account-resolver.ts:30-57`).

## How it works

1. Register an OAuth client with `register_google_oauth_app`; the client secret is encrypted before insertion, and duplicate labels return an error (`packages/gtm/src/tools/register-google-oauth-app.ts:12-46`, `packages/gtm/src/lib/db/oauth-apps-repo.ts:57-103`).
2. Start `start_google_oauth_flow` with the app and a free account label. It creates a random state token, binds a loopback listener, constructs the authorization URL, and waits up to 300 seconds for a matching callback (`packages/gtm/src/tools/start-google-oauth-flow.ts:13-47`).
3. Exchange the callback code, fetch Google user info, then store the tokens encrypted along with scopes, expiry, email, and the OAuth app relation (`packages/gtm/src/tools/start-google-oauth-flow.ts:58-82`, `packages/gtm/src/lib/db/accounts-repo.ts:100-159`).
4. Alternatively, `register_google_service_account` reads a JSON key file, parses it, requests a token to verify it, and only then stores the encrypted key and access token (`packages/gtm/src/tools/register-google-service-account.ts:12-52`).
5. A caller can select an account by label or omit `account` to use the configured default. Resolution fails if the label is missing, no default exists, or the selected identity lacks the exact required scope (`packages/gtm/src/lib/account-resolver.ts:30-57`).
6. `set_default_google_account` clears the previous default and sets the selected account in one database transaction; deleting an account removes its local record (`packages/gtm/src/lib/db/accounts-repo.ts:230-246`).

### Modes

| Mode | Inputs and limits | Stored credentials | Failure behavior |
|---|---|---|---|
| User OAuth | Registered app label, unique account label, optional login hint; loopback authorization wait is 300 seconds (`packages/gtm/src/index.ts:210-231`, `packages/gtm/src/tools/start-google-oauth-flow.ts:23-47`) | Encrypted access and refresh tokens; app ID, granted scopes, expiry, email (`packages/gtm/src/lib/db/accounts-repo.ts:100-159`) | Missing app, duplicate account label, callback timeout, Google error, or failed token exchange returns MCP error content (`packages/gtm/src/tools/start-google-oauth-flow.ts:19-28`, `packages/gtm/src/tools/start-google-oauth-flow.ts:47-56`, `packages/gtm/src/tools/start-google-oauth-flow.ts:99-101`) |
| Service account | Absolute JSON key path and space-delimited scopes (`packages/gtm/src/index.ts:288-298`) | Encrypted service-account JSON and access token, project ID, email, scopes, expiry (`packages/gtm/src/tools/register-google-service-account.ts:42-52`) | File read, key parsing, token exchange, or insertion errors are returned as MCP error content; failed verification prevents storage (`packages/gtm/src/tools/register-google-service-account.ts:18-39`, `packages/gtm/src/tools/register-google-service-account.ts:69-71`) |
| Legacy completion command | App label, account label, code, state (`packages/gtm/src/index.ts:234-255`) | Nothing | Always returns an error directing the caller to loopback OAuth (`packages/gtm/src/tools/complete-google-oauth-flow.ts:1-19`) |

## Business rules

- OAuth app labels and account labels are unique in the database; account labels cannot be reused until the existing account is deleted (`packages/core/src/db/migrations.ts:145-169`, `packages/gtm/src/tools/start-google-oauth-flow.ts:23-28`).
- An OAuth app cannot be deleted while an account references it; the repository rejects deletion in a transaction (`packages/gtm/src/lib/db/oauth-apps-repo.ts:118-143`).
- Only one account is marked default by the setter's transaction, and a nonexistent account ID rolls the transaction back (`packages/gtm/src/lib/db/accounts-repo.ts:230-242`).
- GTM operations require the exact scope requested by the operation to appear in `scopes_granted` (`packages/gtm/src/lib/account-resolver.ts:49-55`).
- Secret-bearing values are stored encrypted and are omitted from public list shapes (`packages/gtm/src/lib/db/accounts-repo.ts:24-54`, `packages/gtm/src/lib/db/oauth-apps-repo.ts:16-45`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `list_google_oauth_apps` | `packages/gtm/src/index.ts:136-150` | List app metadata without secrets |
| `register_google_oauth_app` | `packages/gtm/src/index.ts:152-179` | Store a Google OAuth client |
| `delete_google_oauth_app` | `packages/gtm/src/index.ts:181-194` | Delete an unreferenced OAuth client |
| `list_google_accounts` | `packages/gtm/src/index.ts:196-208` | List connected account metadata |
| `start_google_oauth_flow` | `packages/gtm/src/index.ts:210-232` | Run loopback OAuth and store the connected account |
| `complete_google_oauth_flow` | `packages/gtm/src/index.ts:234-256` | Deprecated command; returns an error |
| `delete_google_account` | `packages/gtm/src/index.ts:258-271` | Delete local account credentials |
| `set_default_google_account` | `packages/gtm/src/index.ts:273-286` | Select the default identity |
| `register_google_service_account` | `packages/gtm/src/index.ts:288-300` | Verify and store service-account credentials |

## Package shape

The capability consists of MCP registrations and tool handlers under `packages/gtm/src/tools/`, SQLite access in `packages/gtm/src/lib/db/`, and account selection in `packages/gtm/src/lib/account-resolver.ts` (`packages/gtm/src/index.ts:1-16`, `packages/gtm/src/lib/account-resolver.ts:1-57`).

## Internal model

The repositories map encrypted database rows into either public account/app shapes or full decrypted rows. Only internal callers that need a token receive the full shape; list tools use public shapes (`packages/gtm/src/lib/db/accounts-repo.ts:24-87`, `packages/gtm/src/lib/db/oauth-apps-repo.ts:16-45`). The token broker receives the resolved identity when `executeGtmCall` requests a valid Google access token (`packages/gtm/src/lib/gtm-client.ts:95-108`).

## Dependencies

The package uses `@ohmy-seo/mcp-core` for database access, encryption, OAuth loopback and token exchange, and errors; Zod defines registration input schemas (`packages/gtm/package.json:18-22`, `packages/gtm/src/tools/start-google-oauth-flow.ts:2-10`, `packages/gtm/src/tools/register-google-service-account.ts:2-8`).

## Gotchas

`complete_google_oauth_flow` remains registered but cannot complete an authorization; use `start_google_oauth_flow` (`packages/gtm/src/index.ts:234-256`, `packages/gtm/src/tools/complete-google-oauth-flow.ts:1-19`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [GTM MCP tool API](../api.md)
- [GTM workspace gotchas](../gotchas.md)
- [Google Tag Manager workspace overview](../overview.md)

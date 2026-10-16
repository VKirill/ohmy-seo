---
title: Google Ads Account Access
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-ads, oauth, accounts]
sources:
  - packages/google-ads/src/index.ts
  - packages/google-ads/src/tools/start-google-oauth-flow.ts
  - packages/google-ads/src/tools/register-google-service-account.ts
  - packages/google-ads/src/lib/db/accounts-repo.ts
  - packages/google-ads/src/lib/db/oauth-apps-repo.ts
  - packages/google-ads/src/lib/account-resolver.ts
  - packages/core/src/db/migrations.ts
  - packages/google-ads/src/tools/set-default-google-account.ts
  - packages/google-ads/src/tools/delete-google-account.ts
---

# Google Ads Account Access

**TL;DR:** This capability stores OAuth app credentials and connected Google Ads credentials, then resolves an explicitly named or default account for Ads calls.

## Purpose

Account access provides two credential registration paths: a browser-based user OAuth flow using a registered OAuth app, and a service-account JSON key flow. Both create an account record used by the Ads client (`packages/google-ads/src/tools/start-google-oauth-flow.ts:13-17`, `packages/google-ads/src/tools/register-google-service-account.ts:12-16`). Stored fields and ownership are described in the [data model](../data-model.md).

## How it works

1. Register an OAuth app with a unique label, client ID, secret, declared scopes, and redirect URI; the repository encrypts the secret before writing the row (`packages/google-ads/src/index.ts:169-179`, `packages/google-ads/src/lib/db/oauth-apps-repo.ts:57-101`).
2. Start user OAuth with an app label and new account label. The server rejects missing apps and duplicate account labels, starts a loopback listener, creates a random state, and opens a URL using the app's declared scopes (`packages/google-ads/src/tools/start-google-oauth-flow.ts:13-43`).
3. Wait up to 300 seconds for the callback. Timeout, OAuth callback errors, or token exchange failures return an MCP error; successful exchange fetches user email when the profile request succeeds (`packages/google-ads/src/tools/start-google-oauth-flow.ts:45-70`, `packages/google-ads/src/tools/start-google-oauth-flow.ts:99-101`).
4. Store the OAuth account with its app reference, granted scope string, token expiry, and encrypted access and refresh tokens (`packages/google-ads/src/tools/start-google-oauth-flow.ts:72-82`, `packages/google-ads/src/lib/db/accounts-repo.ts:100-161`).
5. For service-account access, read and parse the JSON key, request an access token to verify the key and scopes, then store the encrypted JSON and access token. A failed verification returns an error before the account is saved (`packages/google-ads/src/tools/register-google-service-account.ts:18-40`, `packages/google-ads/src/tools/register-google-service-account.ts:42-52`).
6. For each Ads operation, resolve the selected account (or the configured default) and verify its granted scope contains the required scope (`packages/google-ads/src/lib/account-resolver.ts:30-58`).

### Modes

| Mode | Input and stored credentials | Output and failure behavior | Evidence |
|---|---|---|---|
| User OAuth | Registered app label, account label, optional login hint; callback exchange yields access and refresh token. | Stores a user account tied to `oauth_app_id`; a 5-minute callback timeout or OAuth error produces an MCP error. | `packages/google-ads/src/tools/start-google-oauth-flow.ts:13-28`, `packages/google-ads/src/tools/start-google-oauth-flow.ts:45-63`, `packages/google-ads/src/tools/start-google-oauth-flow.ts:72-82` |
| Service account | Account label, absolute JSON key path, and space-delimited scopes. | Stores a service-account record only after JWT token exchange succeeds; file read, key parse, or token exchange errors return an MCP error. | `packages/google-ads/src/tools/register-google-service-account.ts:12-40`, `packages/google-ads/src/tools/register-google-service-account.ts:42-52` |
| Explicit account selection | Optional `account` label on Ads tools. | Unknown label raises `AccountNotFoundError`; missing required scope raises `InsufficientScopeError`. | `packages/google-ads/src/lib/account-resolver.ts:30-55` |
| Default account selection | Omit `account`; select the row marked default. | Missing default raises `AmbiguousAccountError`, including when no accounts exist. | `packages/google-ads/src/lib/account-resolver.ts:42-47` |

## Business rules

- Labels accepted by the MCP schemas are 1–64 characters and restricted to letters, digits, dash, and underscore (`packages/google-ads/src/index.ts:132-137`).
- OAuth app deletion is blocked while any Google account references that app; the repository transaction checks attachments before deletion (`packages/google-ads/src/lib/db/oauth-apps-repo.ts:118-143`).
- Account labels are unique in the shared database schema (`packages/core/src/db/migrations.ts:145-160`).
- The account resolver does not fall back to an arbitrary account: callers must name an account or have a default selected (`packages/google-ads/src/lib/account-resolver.ts:37-47`).
- Google Ads operations require the Ads scope. The resolver checks the exact required scope string before returning an account (`packages/google-ads/src/lib/account-resolver.ts:49-55`).
- `complete_google_oauth_flow` is registered as deprecated and documents that the OOB flow was removed; use `start_google_oauth_flow` (`packages/google-ads/src/index.ts:203-211`).

## Public API

These are MCP tools registered by the server, with inputs taken from their schemas (`packages/google-ads/src/index.ts:161-233`).

| Tool | Purpose |
|---|---|
| `list_google_oauth_apps` | List OAuth apps without returning client secrets. |
| `register_google_oauth_app` | Store an OAuth app definition. |
| `delete_google_oauth_app` | Delete an unreferenced OAuth app. |
| `list_google_accounts` | List accounts without returning plaintext tokens. |
| `start_google_oauth_flow` | Connect an account through the loopback browser flow. |
| `complete_google_oauth_flow` | Deprecated OOB OAuth entry point. |
| `delete_google_account` | Remove an account and its encrypted credentials. |
| `set_default_google_account` | Select the default account for Ads tools. |
| `register_google_service_account` | Verify and store a service account key. |

## Package shape

- `src/tools/*google*` implements each MCP account setup operation.
- `src/lib/db/accounts-repo.ts` and `src/lib/db/oauth-apps-repo.ts` read and write persisted credentials.
- `src/lib/account-resolver.ts` selects the account used by Ads operations.
- `src/index.ts` defines the tool schemas and registers their implementations (`packages/google-ads/src/index.ts:14-22`, `packages/google-ads/src/index.ts:161-233`).

## Internal model

OAuth app records own the client ID, encrypted secret, declared scopes, and redirect URI. User accounts reference an OAuth app and hold encrypted tokens; service accounts hold encrypted key JSON and do not need an OAuth app reference (`packages/core/src/db/migrations.ts:145-169`, `packages/google-ads/src/lib/db/accounts-repo.ts:100-147`).

The repositories deliberately return public projections without encrypted fields, while internal lookup functions decrypt secrets when a token exchange needs them (`packages/google-ads/src/lib/db/oauth-apps-repo.ts:28-44`, `packages/google-ads/src/lib/db/oauth-apps-repo.ts:46-55`, `packages/google-ads/src/lib/db/accounts-repo.ts:55-87`).

## Dependencies

The feature uses the shared Google OAuth implementation, SQLite database and encryption functions from `@ohmy-seo/mcp-core` (`packages/google-ads/src/tools/start-google-oauth-flow.ts:1-9`, `packages/google-ads/src/lib/db/accounts-repo.ts:1-4`).

## Gotchas

- The OAuth callback listener binds a loopback port; the generated callback URL is used for the authorization exchange and is not a public web route (`packages/google-ads/src/tools/start-google-oauth-flow.ts:30-43`).
- The registered `redirect_uri` is persisted but the start flow builds the authorization URL and exchanges the code with the callback URL returned by the loopback listener (`packages/google-ads/src/lib/db/oauth-apps-repo.ts:57-84`, `packages/google-ads/src/tools/start-google-oauth-flow.ts:34-43`, `packages/google-ads/src/tools/start-google-oauth-flow.ts:58-63`).
- A user token can be stored even when Google omits `refresh_token`; renewal behavior then depends on the access token and OAuth core implementation (`packages/google-ads/src/tools/start-google-oauth-flow.ts:72-82`).
- Account selection without a named or default account returns an error rather than choosing the only configured account (`packages/google-ads/src/lib/account-resolver.ts:42-47`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Data Model](../data-model.md)
- [Google Ads Workspace — Overview](../overview.md)

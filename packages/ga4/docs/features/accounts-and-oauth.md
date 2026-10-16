---
title: Google account and OAuth management
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: high
tags: [ga4, oauth, credentials]
sources:
  - packages/ga4/src/tools/start-google-oauth-flow.ts
  - packages/ga4/src/lib/db/accounts-repo.ts
  - packages/ga4/src/lib/db/oauth-apps-repo.ts
  - packages/ga4/src/tools/register-google-service-account.ts
  - packages/ga4/src/tools/register-google-oauth-app.ts
  - packages/ga4/src/lib/account-resolver.ts
  - packages/ga4/src/index.ts
  - packages/core/src/db/migrations.ts
  - packages/ga4/src/tools/complete-google-oauth-flow.ts
  - packages/ga4/src/tools/delete-google-account.ts
  - packages/ga4/src/lib/ga4-client.ts
---

# Google account and OAuth management

TL;DR: This capability stores encrypted Google OAuth app secrets and account tokens, supports loopback user OAuth and verified service-account registration, and selects an account for GA4 calls (packages/ga4/src/lib/db/oauth-apps-repo.ts:57-101, packages/ga4/src/lib/db/accounts-repo.ts:100-162).

## Purpose

Set up Google credentials, inspect apps and accounts, choose a default, and remove credentials (packages/ga4/src/index.ts:104-177). See [data model](../data-model/google-credentials.md).

## How it works

1. Register an OAuth app with label, client ID, secret, declared scopes, and redirect URI. OOB redirect URIs are rejected; insertion encrypts the secret (packages/ga4/src/tools/register-google-oauth-app.ts:6-31, packages/ga4/src/lib/db/oauth-apps-repo.ts:57-91).
2. Start user OAuth with app and desired account labels. The tool rejects unknown apps and used labels, creates random state, opens a loopback listener, builds the authorization URL, and waits 300,000 ms for callback (packages/ga4/src/tools/start-google-oauth-flow.ts:13-47).
3. Exchange the callback code, request Google userinfo for email, and save encrypted access/refresh tokens (packages/ga4/src/tools/start-google-oauth-flow.ts:47-82, packages/ga4/src/lib/db/accounts-repo.ts:114-160).
4. For a service account, read the JSON key path, parse it, exchange a signed JWT for an access token, and save only after verification succeeds (packages/ga4/src/tools/register-google-service-account.ts:12-52).
5. List public app/account records without secrets; set a default by clearing the existing default and marking the selected account (packages/ga4/src/lib/db/oauth-apps-repo.ts:46-55, packages/ga4/src/lib/db/accounts-repo.ts:88-98, packages/ga4/src/lib/db/accounts-repo.ts:230-241).
6. API tools resolve a named account or the default and check its granted scopes (packages/ga4/src/lib/account-resolver.ts:30-57).

### Modes

| Mode | Inputs | Output and failure |
|---|---|---|
| OAuth user | App label, unused account label, optional login hint; configurable loopback port. | Encrypted tokens saved after callback. Unknown app, duplicate label, OAuth error, or 5-minute timeout returns MCP error; timeout asks caller to restart (packages/ga4/src/tools/start-google-oauth-flow.ts:19-27, packages/ga4/src/tools/start-google-oauth-flow.ts:47-82). |
| Service account | Account label, JSON key path, space-delimited scopes. | Saves encrypted JSON and access token after verification; file or token exchange failure prevents insert (packages/ga4/src/tools/register-google-service-account.ts:18-52). |
| Deprecated OOB | App/account labels, code, state. | Always returns a deprecation error, with no persistence (packages/ga4/src/tools/complete-google-oauth-flow.ts:6-20). |

## Business rules

- Labels are 1–64 characters and allow letters, digits, underscore, or hyphen (packages/ga4/src/index.ts:98-101).
- App and account labels are unique in their tables (packages/core/src/db/migrations.ts:145-158).
- An OAuth app cannot be deleted while accounts refer to it (packages/ga4/src/lib/db/oauth-apps-repo.ts:118-142).
- Account deletion removes saved tokens; setting a default clears the prior default in the same transaction (packages/ga4/src/tools/delete-google-account.ts:6-17, packages/ga4/src/lib/db/accounts-repo.ts:230-241).
- If account is omitted, a default must exist; every API call requires its requested scope (packages/ga4/src/lib/account-resolver.ts:35-55).

## Public API

The nine public MCP commands are named and fully parameterized in [API](../api.md#google-account-and-oauth). Their exported handlers are:

| Handler | Source | Purpose |
|---|---|---|
| runListGoogleOauthApps, runRegisterGoogleOauthApp, runDeleteGoogleOauthApp | packages/ga4/src/index.ts:106-128 | List, register, and remove OAuth apps. |
| runListGoogleAccounts, runStartGoogleOauthFlow, runCompleteGoogleOauthFlow | packages/ga4/src/index.ts:130-155 | List accounts and run OAuth connection commands. |
| runDeleteGoogleAccount, runSetDefaultGoogleAccount, runRegisterServiceAccount | packages/ga4/src/index.ts:157-177 | Remove/select accounts and register service credentials. |
## Package shape

- `src/tools/*google*` implements credential operations and OAuth flows.
- `src/lib/db/accounts-repo.ts` and `oauth-apps-repo.ts` own persistence access.
- `src/lib/account-resolver.ts` selects accounts; `src/lib/ga4-client.ts` obtains access tokens (packages/ga4/src/lib/ga4-client.ts:44-77).

## Internal model

OAuth user accounts refer to an OAuth app; service accounts store JSON key on the account without an app reference. Public projections omit decrypted secrets (packages/ga4/src/lib/db/accounts-repo.ts:6-36, packages/core/src/db/migrations.ts:155-169).

## Dependencies

The feature uses core OAuth, encryption, config-backed SQLite, and MCP error helpers (packages/ga4/src/tools/start-google-oauth-flow.ts:1-9, packages/ga4/src/lib/db/accounts-repo.ts:1-2).

## Gotchas

- `complete_google_oauth_flow` remains registered but always fails; use `start_google_oauth_flow` (packages/ga4/src/index.ts:146-155, packages/ga4/src/tools/complete-google-oauth-flow.ts:12-20).
- The app redirect URI is stored, but the OAuth flow uses the actual loopback callback URI (packages/ga4/src/lib/db/oauth-apps-repo.ts:57-65, packages/ga4/src/tools/start-google-oauth-flow.ts:34-42).
- Scope is checked by account resolution and again by the API client (packages/ga4/src/lib/account-resolver.ts:49-55, packages/ga4/src/lib/ga4-client.ts:48-55).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Analytics 4 workspace overview](../overview.md)

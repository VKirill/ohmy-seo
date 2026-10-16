---
title: Google account and OAuth management
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-search-console, oauth, accounts]
sources:
  - packages/google-search-console/src/index.ts
  - packages/google-search-console/src/tools/start-google-oauth-flow.ts
  - packages/google-search-console/src/tools/register-google-service-account.ts
  - packages/google-search-console/src/lib/account-resolver.ts
  - packages/google-search-console/src/lib/db/accounts-repo.ts
  - packages/google-search-console/src/lib/db/oauth-apps-repo.ts
  - packages/google-search-console/src/tools/register-google-oauth-app.ts
  - packages/google-search-console/src/tools/complete-google-oauth-flow.ts
  - packages/google-search-console/src/lib/gsc-client.ts
  - packages/core/src/db/migrations.ts
---
# Google account and OAuth management

TL;DR: This capability stores OAuth client apps and Google user or service accounts, resolves an explicit or default account for API tools, and checks granted scopes before calls (`packages/google-search-console/src/lib/account-resolver.ts:34-66`, `packages/google-search-console/src/lib/db/accounts-repo.ts:100-160`).

## Purpose

Provide persistent credentials for the Search Console and Indexing API tools without returning stored secrets in account or OAuth-app list responses (`packages/google-search-console/src/lib/db/accounts-repo.ts:23-36`, `packages/google-search-console/src/lib/db/oauth-apps-repo.ts:16-37`).

## How it works

1. Register a Google OAuth app with `register_google_oauth_app`; the repository encrypts the client secret and stores its label, client ID, declared scopes, redirect URI, and creation time (`packages/google-search-console/src/index.ts:133-160`, `packages/google-search-console/src/lib/db/oauth-apps-repo.ts:57-101`).
2. Connect a user account with `start_google_oauth_flow`. The tool checks that app and account labels exist or are unused, creates a random state, starts a loopback listener, builds the authorization URL, waits up to five minutes, exchanges the code, requests user email, and stores the account and tokens (`packages/google-search-console/src/tools/start-google-oauth-flow.ts:13-47`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:49-97`).
3. Alternatively, register a service account by reading its JSON key file, parsing it, exchanging a signed JWT for an access token, and storing the JSON credential and token (`packages/google-search-console/src/tools/register-google-service-account.ts:12-52`).
4. A GSC tool selects the account named by its optional `account` argument; if omitted, it resolves the configured default. It then checks whether granted scopes satisfy the requested scope (`packages/google-search-console/src/lib/account-resolver.ts:40-66`).
5. `executeGscCall` refreshes or obtains an access token through the shared OAuth broker, loading the OAuth app secret for user OAuth accounts (`packages/google-search-console/src/lib/gsc-client.ts:41-72`).

| Variant | Input and behavior | Stored result | Evidence |
|---|---|---|---|
| OAuth user | Registered app label, free account label, optional login hint; browser authorization completes at a loopback callback, with a 300,000 ms wait limit | App foreign key, email when available, granted scopes, encrypted access and refresh tokens | `packages/google-search-console/src/tools/start-google-oauth-flow.ts:13-47`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:65-82` |
| Service account | Account label, readable JSON key path, space-delimited scopes; key is verified by token exchange before persistence | Email, project ID, scopes, encrypted JSON key and access token | `packages/google-search-console/src/tools/register-google-service-account.ts:12-52` |
| Deprecated manual completion | App/account labels, authorization code, and state | No state change; returns an error directing caller to loopback flow | `packages/google-search-console/src/tools/complete-google-oauth-flow.ts:1-19` |

**Failures:** Missing OAuth app, duplicate account label, Google callback error, timeout, unreadable/invalid service-account key, and token-exchange failure return MCP errors; service-account verification failure occurs before saving (`packages/google-search-console/src/tools/start-google-oauth-flow.ts:19-27`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:47-55`, `packages/google-search-console/src/tools/register-google-service-account.ts:18-39`). Missing requested scopes raise `InsufficientScopeError`; an explicit unknown account raises `AccountNotFoundError` (`packages/google-search-console/src/lib/account-resolver.ts:6-28`, `packages/google-search-console/src/lib/account-resolver.ts:47-64`).

## Business rules

- Labels are unique in the database; OAuth app labels are unique and account labels are unique (`packages/core/src/db/migrations.ts:145-158`).
- OAuth client secrets and account token/key values are encrypted on insert and decrypted only for internal full-row reads; public row shapes omit them (`packages/google-search-console/src/lib/db/oauth-apps-repo.ts:28-44`, `packages/google-search-console/src/lib/db/accounts-repo.ts:23-36`, `packages/google-search-console/src/lib/db/accounts-repo.ts:71-79`).
- An OAuth app cannot be deleted while any Google account references it (`packages/google-search-console/src/lib/db/oauth-apps-repo.ts:118-142`).
- Setting a default clears the prior default and sets the requested account in one transaction; a nonexistent ID throws (`packages/google-search-console/src/lib/db/accounts-repo.ts:230-241`).
- A full `webmasters` scope satisfies a requested `webmasters.readonly` scope (`packages/google-search-console/src/lib/account-resolver.ts:30-38`).
- The stored `redirect_uri` input is rejected only when equal to the OOB URI; the authorization flow uses the callback URL returned by its active loopback listener (`packages/google-search-console/src/tools/register-google-oauth-app.ts:13-23`, `packages/google-search-console/src/tools/start-google-oauth-flow.ts:34-42`).

## Public API

| MCP tool | File:line | Purpose |
|---|---|---|
| `list_google_oauth_apps` | `packages/google-search-console/src/index.ts:118-131` | List apps without returning client secrets |
| `register_google_oauth_app` | `packages/google-search-console/src/index.ts:133-160` | Store OAuth client credentials |
| `delete_google_oauth_app` | `packages/google-search-console/src/index.ts:162-175` | Delete an unreferenced app |
| `list_google_accounts` | `packages/google-search-console/src/index.ts:177-189` | List connected account metadata |
| `start_google_oauth_flow` | `packages/google-search-console/src/index.ts:191-213` | Connect an OAuth user via loopback callback |
| `complete_google_oauth_flow` | `packages/google-search-console/src/index.ts:215-237` | Deprecated error response; no longer completes OAuth |
| `delete_google_account` | `packages/google-search-console/src/index.ts:239-252` | Remove an account row and its credentials |
| `set_default_google_account` | `packages/google-search-console/src/index.ts:254-267` | Select the default account |
| `register_google_service_account` | `packages/google-search-console/src/index.ts:269-290` | Verify and store service account credentials |

## Package shape

- Tool registration and MCP schemas: `src/index.ts`.
- OAuth user and service-account orchestration: `src/tools/start-google-oauth-flow.ts`, `src/tools/register-google-service-account.ts`.
- Account resolution and persistence: `src/lib/account-resolver.ts`, `src/lib/db/accounts-repo.ts`, `src/lib/db/oauth-apps-repo.ts`.

## Internal model

The account resolver returns a full internal account row, including decrypted credentials. The public list tools return a narrower representation without credential fields (`packages/google-search-console/src/lib/db/accounts-repo.ts:23-36`, `packages/google-search-console/src/lib/db/accounts-repo.ts:71-79`). OAuth app lookup follows the same public/full split (`packages/google-search-console/src/lib/db/oauth-apps-repo.ts:16-44`).

The account row's `auth_method` distinguishes OAuth user credentials from service-account JSON; the client supplies OAuth client credentials only when an OAuth account has an app ID (`packages/google-search-console/src/lib/db/accounts-repo.ts:6-21`, `packages/google-search-console/src/lib/gsc-client.ts:53-63`). See [data-model.md](../data-model.md) for field meanings and lifecycle.

## Dependencies

- `@ohmy-seo/mcp-core/google-oauth` for authorization URLs, loopback callback, token exchanges, and access-token acquisition (`packages/google-search-console/src/tools/start-google-oauth-flow.ts:1-6`, `packages/google-search-console/src/tools/register-google-service-account.ts:1-6`, `packages/google-search-console/src/lib/gsc-client.ts:1-5`).
- `@ohmy-seo/mcp-core/db` and `@ohmy-seo/mcp-core/crypto` for SQLite and secret encryption (`packages/google-search-console/src/lib/db/accounts-repo.ts:1-2`).

## Gotchas

`complete_google_oauth_flow` remains registered, but its implementation always returns an error and does not save credentials (`packages/google-search-console/src/index.ts:215-237`, `packages/google-search-console/src/tools/complete-google-oauth-flow.ts:6-19`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Search Console MCP API](../api.md)
- [Google Search Console data model](../data-model.md)
- [Google Search Console workspace overview](../overview.md)

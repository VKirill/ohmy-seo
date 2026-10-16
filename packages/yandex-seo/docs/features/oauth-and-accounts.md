---
title: Yandex OAuth and account management
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, oauth, accounts]
sources:
  - packages/yandex-seo/src/tools/oauth-start-flow.ts
  - packages/yandex-seo/src/registry/oauth.ts
  - packages/yandex-seo/src/tools/oauth-complete-flow.ts
  - packages/yandex-seo/src/lib/oauth/yandex-flow.ts
  - packages/yandex-seo/src/lib/oauth/token-broker.ts
  - packages/yandex-seo/src/lib/db/oauth-apps-repo.ts
  - packages/yandex-seo/src/lib/db/accounts-repo.ts
  - packages/yandex-seo/src/lib/account-resolver.ts
---
# Yandex OAuth and account management

TL;DR: This capability stores Yandex OAuth applications and connected accounts, completes authorization-code exchange, encrypts credentials through core services, and resolves accounts for API tools (`packages/yandex-seo/src/registry/oauth.ts:13-37,103-129`).

## Purpose

MCP clients can register OAuth apps, connect multiple Yandex accounts, inspect labels and scopes without exposing secrets or tokens, and choose an account explicitly or through the default account (`packages/yandex-seo/src/registry/oauth.ts:14-44,103-129,187-208`).

## How it works

1. `register_oauth_app` validates a label, client ID, client secret, and declared scopes, then stores the application; the repository encrypts the secret before insert (`packages/yandex-seo/src/registry/oauth.ts:27-49`, `packages/yandex-seo/src/lib/db/oauth-apps-repo.ts:51-84`).
2. `start_oauth_flow` checks the app and unused account label, then returns an authorization URL; pending authorization state is not stored by this flow (`packages/yandex-seo/src/tools/oauth-start-flow.ts:10-21`, `packages/yandex-seo/src/lib/oauth/yandex-flow.ts:16-27`).
3. The operator completes approval in Yandex and calls `complete_oauth_flow` with app label, account label, and code; the tool exchanges the code, probes Yandex Login and Webmaster identity, then saves the account (`packages/yandex-seo/src/tools/oauth-complete-flow.ts:14-57`).
4. The account repository encrypts access and refresh tokens, stores their expiry and scopes, and links the account to the OAuth app (`packages/yandex-seo/src/lib/db/accounts-repo.ts:101-158`).
5. API tools resolve an explicit account label first, then the default account, otherwise a unique account with the required scope; token retrieval refreshes expired or near-expiry credentials (`packages/yandex-seo/src/lib/account-resolver.ts:6-47`, `packages/yandex-seo/src/lib/oauth/token-broker.ts:21-71`).

### Modes

| Operation | Inputs and behavior | Output or state change | Evidence |
|---|---|---|---|
| Register app | Label 1–64 characters matching letters, digits, `_`, `-`; client ID and secret 8–256 characters; scope string 1–512 characters | Stores app; list responses omit the secret | `packages/yandex-seo/src/registry/oauth.ts:27-49` |
| Connect account | App label, unique account label, authorization code; returned code schema allows 6–16 characters | Creates linked account with encrypted tokens and discovered identity | `packages/yandex-seo/src/registry/oauth.ts:103-129`, `packages/yandex-seo/src/tools/oauth-complete-flow.ts:14-57` |
| Select account | Explicit account, default account, or unique scope-matching account | Resolved account ID or resolution error | `packages/yandex-seo/src/lib/account-resolver.ts:6-47` |
| Refresh token | Triggered during access-token retrieval when expiry is near | Persists rotated access/refresh tokens and expiry | `packages/yandex-seo/src/lib/oauth/token-broker.ts:21-71`, `packages/yandex-seo/src/lib/db/accounts-repo.ts:185-215` |

### Failures

- Unknown OAuth app or occupied account label causes the start flow to throw before creating an authorization URL (`packages/yandex-seo/src/tools/oauth-start-flow.ts:10-21`).
- Code exchange or identity-probe errors prevent account insertion; Webmaster identity can be absent when the probe fails (`packages/yandex-seo/src/tools/oauth-complete-flow.ts:14-57`).
- Deleting an OAuth app is rejected while accounts reference it; delete those accounts first (`packages/yandex-seo/src/lib/db/oauth-apps-repo.ts:105-143`).
- Account resolution fails when no explicit, default, or unique scope-compatible account exists (`packages/yandex-seo/src/lib/account-resolver.ts:18-47`).
- Token-refresh failure propagates to the API call; concurrent refreshes for the same account share an in-flight promise (`packages/yandex-seo/src/lib/oauth/token-broker.ts:21-71`).

## Business rules

- OAuth app labels and account labels use the same alphanumeric, dash, and underscore pattern and have maximum length 64 (`packages/yandex-seo/src/registry/oauth.ts:30-34,91-95`).
- OAuth app deletion is blocked by attached accounts, preserving the foreign-key relationship needed to refresh tokens (`packages/yandex-seo/src/lib/db/oauth-apps-repo.ts:105-143`).
- Account resolution prioritizes an explicit label; absent that, a configured default wins before unique scope matching (`packages/yandex-seo/src/lib/account-resolver.ts:11-47`).
- Setting a default clears the existing default before setting the chosen account (`packages/yandex-seo/src/lib/db/accounts-repo.ts:232-242`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `list_oauth_apps`, `register_oauth_app`, `delete_oauth_app` | `packages/yandex-seo/src/registry/oauth.ts:14-101` | Inspect, add, and remove OAuth apps |
| `list_accounts`, `start_oauth_flow`, `complete_oauth_flow` | `packages/yandex-seo/src/registry/oauth.ts:103-185` | Inspect accounts and connect one |
| `delete_account`, `set_default_account` | `packages/yandex-seo/src/registry/oauth.ts:187-208` | Remove or select an account |

## Package shape

- `src/registry/oauth.ts` defines MCP schemas and handlers.
- `src/tools/oauth-*.ts` implements tool use cases.
- `src/lib/oauth/` implements authorization and token refresh.
- `src/lib/db/*-repo.ts` accesses tables owned by `@ohmy-seo/mcp-core`.

## Internal model

An OAuth app owns client credentials and declared scopes; accounts point to an app and contain encrypted token material, identity, and account-level scope data. Repository operations call `getDb()` from core rather than defining this workspace's SQL schema (`packages/yandex-seo/src/lib/db/oauth-apps-repo.ts:1-4`, `packages/yandex-seo/src/lib/db/accounts-repo.ts:1-4`).

## Dependencies

This capability uses Zod schemas and `@ohmy-seo/mcp-core` database and crypto services (`packages/yandex-seo/src/registry/oauth.ts:1-3`, `packages/yandex-seo/src/lib/db/accounts-repo.ts:1-4`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex SEO workspace overview](../overview.md)

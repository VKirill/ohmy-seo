---
title: Google OAuth and Token Broker
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: high
tags: [google-oauth, authentication, mcp-core]
sources:
  - packages/core/src/google-oauth/index.ts
  - packages/core/src/google-oauth/oauth-user-flow.ts
  - packages/core/src/google-oauth/service-account-flow.ts
  - packages/core/src/google-oauth/token-broker.ts
  - packages/core/src/google-oauth/errors.ts
  - packages/core/src/google-oauth/scopes.ts
---
# Google OAuth and Token Broker

TL;DR: This subpath provides OAuth authorization-code helpers, a loopback callback listener, service-account JWT exchange, token refresh coordination, Google error classification, and scope constants. It does not persist tokens; calling workspaces own persistence (`packages/core/src/google-oauth/index.ts:1-46`, `packages/core/src/google-oauth/token-broker.ts:1-8`).

## Purpose

The `@ohmy-seo/mcp-core/google-oauth` entry point centralizes Google token acquisition primitives shared by GSC, GA4, GTM, and Google Ads workspaces (`packages/core/src/google-oauth/index.ts:1-46`). The token broker accepts already-decrypted account data and returns an access token; the caller must write refreshed tokens to storage (`packages/core/src/google-oauth/token-broker.ts:1-8`, `packages/core/src/google-oauth/token-broker.ts:23-41`).

## How it works

1. For a user OAuth flow, `buildAuthorizeUrl` validates non-empty CSRF state, rejects Google's deprecated OOB redirect, and constructs an offline-consent URL with the supplied scopes (`packages/core/src/google-oauth/oauth-user-flow.ts:34-63`).
2. `LoopbackListener.start()` binds to `127.0.0.1`, tries the preferred port (default 8765), and falls back to an OS-selected port only when the preferred port is occupied (`packages/core/src/google-oauth/oauth-user-flow.ts:141-189`).
3. `waitForCode` accepts only `/oauth/callback`, checks returned state, returns an authorization code or OAuth error, and closes the listener on settlement or timeout (`packages/core/src/google-oauth/oauth-user-flow.ts:192-263`).
4. `exchangeCodeForTokens` posts the authorization code; `refreshAccessToken` posts a refresh token to Google's token endpoint. Non-success responses throw an HTTP-status error (`packages/core/src/google-oauth/oauth-user-flow.ts:76-98`, `packages/core/src/google-oauth/oauth-user-flow.ts:110-131`).
5. For service accounts, `parseServiceAccountJson` validates required fields; `signJwtAssertion` makes a signed RS256 JWT; `exchangeJwtForAccessToken` sends the JWT bearer grant (`packages/core/src/google-oauth/service-account-flow.ts:16-51`, `packages/core/src/google-oauth/service-account-flow.ts:66-94`, `packages/core/src/google-oauth/service-account-flow.ts:107-135`).
6. `getGoogleAccessToken` returns a token with more than five minutes remaining, or shares an in-flight refresh promise for the same account ID. OAuth-user accounts refresh with a refresh token and app credentials; service accounts create and exchange a JWT (`packages/core/src/google-oauth/token-broker.ts:57-100`, `packages/core/src/google-oauth/token-broker.ts:106-151`).

### Modes

| Mode | Inputs | Behavior and output |
|---|---|---|
| OAuth user | Decrypted access/refresh tokens and `OAuthAppInput` | Existing token fast path; otherwise token-endpoint refresh. Missing app or refresh token throws `GoogleAuthError` (`packages/core/src/google-oauth/token-broker.ts:80-86`, `packages/core/src/google-oauth/token-broker.ts:111-129`). |
| Service account | Decrypted JSON and granted scopes | Existing token fast path; otherwise parse key, sign JWT, exchange it for access token (`packages/core/src/google-oauth/token-broker.ts:132-151`). |
| Loopback callback | State plus optional timeout | Returns `{code}`, `{error}`, or `{error: "timeout"}`; default wait timeout is 300,000 ms (`packages/core/src/google-oauth/oauth-user-flow.ts:192-210`). |

### Failure behavior

- Empty authorization state, OOB redirect, invalid service-account JSON/type/required fields, and listener misuse throw errors (`packages/core/src/google-oauth/oauth-user-flow.ts:34-46`, `packages/core/src/google-oauth/service-account-flow.ts:16-35`, `packages/core/src/google-oauth/oauth-user-flow.ts:192-200`).
- Callback path mismatch returns HTTP 404 and continues waiting; state mismatch returns HTTP 400 and continues waiting; timeout closes the listener and resolves with an error result (`packages/core/src/google-oauth/oauth-user-flow.ts:220-243`, `packages/core/src/google-oauth/oauth-user-flow.ts:205-210`).
- OAuth token endpoint failures throw generic HTTP errors; the broker classifies them and throws `GoogleAuthError` with the classification (`packages/core/src/google-oauth/oauth-user-flow.ts:93-95`, `packages/core/src/google-oauth/oauth-user-flow.ts:126-128`, `packages/core/src/google-oauth/token-broker.ts:152-171`).
- A failed service-account exchange redacts private key and token fields from the response body before throwing (`packages/core/src/google-oauth/service-account-flow.ts:122-132`).

## Business rules

- Access token expiry uses Unix seconds; the broker compares `expires_at * 1000` with current milliseconds plus the 300,000 ms refresh threshold (`packages/core/src/google-oauth/token-broker.ts:31-35`, `packages/core/src/google-oauth/token-broker.ts:59-60`, `packages/core/src/google-oauth/token-broker.ts:80-85`).
- Concurrent refreshes for one account ID share one promise; different IDs use separate map entries (`packages/core/src/google-oauth/token-broker.ts:6-8`, `packages/core/src/google-oauth/token-broker.ts:88-99`).
- JWT assertions expire one hour after issuance and use the requested scopes (`packages/core/src/google-oauth/service-account-flow.ts:66-83`).
- `ClassifiedError.re_auth_required` is true only for `invalid_grant`; retryable is true only for rate-limited and server errors (`packages/core/src/google-oauth/errors.ts:52-60`).

## Public API

All exports below are exposed from `@ohmy-seo/mcp-core/google-oauth` (`packages/core/src/google-oauth/index.ts:1-46`).

| Export | File:line | Purpose |
|---|---|---|
| `getGoogleAccessToken`, `AccountInput`, `OAuthAppInput` | `packages/core/src/google-oauth/token-broker.ts:23-100` | Token retrieval and required input shapes. |
| `GoogleAuthError`, `classifyGoogleError`, `ErrorKind`, `ClassifiedError` | `packages/core/src/google-oauth/errors.ts:8-34`, `packages/core/src/google-oauth/errors.ts:75-112` | Error normalization. |
| `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `LoopbackListener` | `packages/core/src/google-oauth/oauth-user-flow.ts:14-32`, `packages/core/src/google-oauth/oauth-user-flow.ts:34-279` | OAuth user flow primitives. |
| `TokenResponse`, `BuildAuthorizeUrlOpts`, `ExchangeCodeOpts`, `RefreshAccessTokenOpts`, `LoopbackListenerOpts` | `packages/core/src/google-oauth/oauth-user-flow.ts:14-32`, `packages/core/src/google-oauth/oauth-user-flow.ts:69-75`, `packages/core/src/google-oauth/oauth-user-flow.ts:104-109`, `packages/core/src/google-oauth/oauth-user-flow.ts:137-140` | Flow input/output types. |
| `parseServiceAccountJson`, `signJwtAssertion`, `exchangeJwtForAccessToken` | `packages/core/src/google-oauth/service-account-flow.ts:16-51`, `packages/core/src/google-oauth/service-account-flow.ts:66-135` | Service-account token path. |
| `ServiceAccountKey`, `SignJwtAssertionParams`, `AccessTokenResponse`, `ExchangeJwtParams` | `packages/core/src/google-oauth/service-account-flow.ts:5-15`, `packages/core/src/google-oauth/service-account-flow.ts:60-65`, `packages/core/src/google-oauth/service-account-flow.ts:96-105` | Service-account data types. |
| Scope constants and `ALL_*_SCOPES` arrays | `packages/core/src/google-oauth/scopes.ts:1-42` | Google API OAuth scope strings and grouped sets. |

## Package shape

- User authorization and callback: `google-oauth/oauth-user-flow.ts`.
- Service account: `google-oauth/service-account-flow.ts`.
- Refresh coordination: `google-oauth/token-broker.ts`.
- Error mapping and scopes: `google-oauth/errors.ts`, `google-oauth/scopes.ts`.
- Stored credential fields are documented in [the credential data model](../data-model/credentials.md).

## Internal model

The token broker is stateless with respect to storage. Its only shared state is the in-process map of refresh promises keyed by account ID (`packages/core/src/google-oauth/token-broker.ts:4-8`, `packages/core/src/google-oauth/token-broker.ts:57-60`).

## Dependencies

The OAuth subpath uses Node HTTP, URL, and crypto facilities plus native `fetch`; it does not import the core HTTP wrapper or a database repository (`packages/core/src/google-oauth/oauth-user-flow.ts:7-8`, `packages/core/src/google-oauth/service-account-flow.ts:1-1`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](../overview.md)

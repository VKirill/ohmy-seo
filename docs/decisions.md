---
title: Architecture decisions
type: decisions
created: 2026-09-13
updated: 2026-10-16
status: active
confidence: low
tags: [decisions, oauth, hosting]
sources:
  - hosting/apps/web/src/lib/db.ts
  - hosting/apps/web/src/lib/connections.ts
  - hosting/apps/web/src/lib/oauth/state.ts
  - hosting/apps/web/src/lib/oauth/index.ts
  - hosting/apps/gateway/src/runtime.ts
  - hosting/apps/gateway/src/tenant.ts
  - hosting/compose.yml
  - hosting/apps/gateway/src/index.ts
---

# Architecture decisions

TL;DR: Hosted login identity, provider data access, and MCP execution are separate concerns; the web app owns durable account state and the gateway materializes tenant-specific package state (`hosting/apps/web/src/lib/db.ts:27-71`, `hosting/apps/gateway/src/tenant.ts:112-179`).

## ADR 1: Separate cabinet identity from data connections

### Context

The cabinet login identifies a user, while provider connections grant access to analytics or advertising data. A login credential must not be treated as a revocable data connection (`hosting/apps/web/src/lib/db.ts:27-29`, `hosting/apps/web/src/lib/db.ts:59-71`).

### Decision

Store Yandex sign-in identities in `login_identities` and provider data grants in `connections`. OAuth state records whether a flow is for `login` or `connect` and binds connection flows to a cabinet user (`hosting/apps/web/src/lib/db.ts:59-71`, `hosting/apps/web/src/lib/oauth/state.ts:5-13`, `hosting/apps/web/src/lib/oauth/state.ts:29-41`).

### Status

Active.

### Consequences

Disconnecting a provider grant does not delete the user's sign-in identity. Provider subject uniqueness and ownership checks prevent the same external account from being connected to a different cabinet (`hosting/apps/web/src/lib/connections.ts:72-80`, `hosting/apps/web/src/lib/connections.ts:90-114`).

## ADR 2: Keep refresh tokens outside tenant package databases

### Context

The existing MCP packages use their own SQLite persistence. The hosted gateway needs to run those packages per user without granting each child process long-lived refresh credentials (`hosting/apps/gateway/src/tenant.ts:112-119`).

### Decision

Keep provider refresh tokens in PostgreSQL. Materialize access tokens with a server-managed placeholder refresh token into a per-user SQLite database; refresh and rewrite tenant rows from the gateway (`hosting/apps/gateway/src/tenant.ts:112-179`).

### Status

Active.

### Consequences

The gateway synchronizes accounts before runtime startup and on a refresh timer; tenant SQLite is derived state that can be rebuilt from hosted connections (`hosting/apps/gateway/src/runtime.ts:108-153`, `hosting/apps/gateway/src/tenant.ts:112-179`).

## ADR 3: Use stateless Streamable HTTP requests for hosted MCP

### Context

The gateway caches child package processes by tenant, while the MCP transport is created per incoming request (`hosting/apps/gateway/src/index.ts:88-99`).

### Decision

Create a fresh MCP server and Streamable HTTP transport for each `POST /mcp`; disable transport session IDs and enable JSON responses (`hosting/apps/gateway/src/index.ts:88-99`, `hosting/apps/gateway/src/index.ts:138-141`).

### Status

Active.

### Consequences

`GET /mcp` returns 405 and `DELETE /mcp` returns 204; clients reconnect by sending another POST and the gateway reuses the tenant runtime (`hosting/apps/gateway/src/index.ts:150-157`, `hosting/apps/gateway/src/runtime.ts:95-119`).

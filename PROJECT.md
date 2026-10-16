---
title: ohmy-seo agent project guide
updated: 2026-10-16
sources:
  - package.json
  - pnpm-workspace.yaml
  - hosting/apps/gateway/src/index.ts
  - hosting/apps/gateway/src/runtime.ts
  - hosting/apps/gateway/src/tool-policy.ts
  - hosting/apps/web/src/lib/db.ts
  - hosting/compose.yml
  - docs/architecture.md
  - docs/gotchas.md
  - docs/deployment.md
---

# ohmy-seo

## Identity

- pnpm monorepo; Node.js `>=22`; package manager `pnpm@10.33.2` (`package.json:1-14`).
- Local MCP workspaces live under `packages/*` (`pnpm-workspace.yaml:1-3`).
- Hosted web cabinet and gateway sources live in `hosting/apps/web` and `hosting/apps/gateway` (`hosting/compose.yml:30-87`).
- System boundaries: [architecture](docs/architecture.md); product description: [overview](docs/overview.md).

## Entry points

- Root build: `pnpm -r build`; root typecheck: `pnpm -r exec tsc --noEmit` (`package.json:8-13`).
- Hosted MCP HTTP entry: `hosting/apps/gateway/src/index.ts`; routes and responses: [architecture](docs/architecture.md#http-routes) (`hosting/apps/gateway/src/index.ts:25-161`).
- Hosted package registry and process lifecycle: `hosting/apps/gateway/src/runtime.ts` (`hosting/apps/gateway/src/runtime.ts:15-39`).
- Web schema and migrations: `hosting/apps/web/src/lib/db.ts` (`hosting/apps/web/src/lib/db.ts:18-114`).
- Per-package overview links: [package docs](docs/packages.md); workspace internals: package `docs/overview.md` pages.

## Critical invariants

- The web application owns the hosted PostgreSQL schema; gateway waits for `api_keys` to exist (`hosting/apps/web/src/lib/db.ts:18-114`, `hosting/apps/gateway/src/index.ts:164-185`).
- User data credentials are scoped to a cabinet; a provider subject already owned by another user cannot be reassigned by connection upsert (`hosting/apps/web/src/lib/connections.ts:72-80`, `hosting/apps/web/src/lib/connections.ts:90-114`).
- Hosted tools come from `READ_TOOLS` and `WRITE_TOOLS`; write confirmation is enforced in `assertHostedCall` (`hosting/apps/gateway/src/tool-policy.ts:4-49`, `hosting/apps/gateway/src/tool-policy.ts:74-118`).
- Hosted tenant SQLite is derived state. Refresh tokens remain in PostgreSQL; tenant materialization writes short-lived access tokens and placeholders (`hosting/apps/gateway/src/tenant.ts:112-179`).
- Preserve unsafe JSON integer IDs as strings; the gateway parses request bodies through `parseJsonSafe` (`hosting/apps/gateway/src/index.ts:21-23`, `hosting/apps/gateway/src/json-safe.ts:19-78`).
- Deployment ref controls gateway source baked into image; pushing Git does not update the running service ([deployment](docs/deployment.md), `hosting/apps/gateway/Dockerfile:1-8`).

## Conventions

- Read the owning workspace documentation before describing package internals ([package documentation map](docs/packages.md)).
- Keep root `docs/data-model.md` as an entity map; schema fields and lifecycle belong to schema-owning workspace pages (`docs/data-model.md`).
- Cite non-trivial documentation claims with `file:line`; maintain pages by editing only claims made stale by code changes (see `~/.agents/skills/docs-methodology/references/maintenance.md`).
- Keep changes in `hosting/` and `packages/` aligned with the surfaces in [hosting operations](hosting/OPERATIONS.md) and root [AGENTS.md](AGENTS.md).

## Common gotchas

- `GET /mcp` is a 405 transport probe; `DELETE /mcp` is a no-op 204 because the gateway is stateless (`hosting/apps/gateway/src/index.ts:150-157`).
- A package tool is not automatically hosted; update gateway allowlist and policy coverage for a hosted tool (`hosting/apps/gateway/src/tool-policy.ts:4-49`).
- Mutagen and XMLStock are not started in cloud unless `ENABLE_SHARED_SERP=true` (`hosting/apps/gateway/src/runtime.ts:34-39`, `hosting/apps/gateway/src/runtime.ts:53-56`).
- Master key loss requires reauthorization because stored provider credentials cannot be decrypted (`hosting/.env.example:7-12`).
- More integration pitfalls: [gotchas](docs/gotchas.md).

## Useful commands

- `pnpm install`
- `pnpm -r build`
- `pnpm -r exec tsc --noEmit`
- `pnpm --filter @ohmy-seo/<workspace> build`
- Hosted compose operations: see [deployment](docs/deployment.md) and [hosting/OPERATIONS.md](hosting/OPERATIONS.md).

## Where to look next

- [System overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Data model map](docs/data-model.md)
- [Small packages](docs/packages.md)
- [Gateway operations](hosting/OPERATIONS.md)

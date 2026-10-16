---
title: ohmy-seo overview
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [mcp, seo, monorepo]
sources:
  - package.json
  - pnpm-workspace.yaml
  - hosting/apps/gateway/src/runtime.ts
  - hosting/apps/web/src/lib/db.ts
  - hosting/apps/gateway/src/index.ts
  - packages/core/package.json
  - hosting/apps/web/src/app/app/page.tsx
  - packages/core/src/index.ts
  - packages/mutagen/package.json
  - packages/roistat/package.json
  - packages/xmlstock/package.json
  - packages/yandex-seo/package.json
  - hosting/apps/web/src/lib/actions.ts
  - hosting/apps/web/src/lib/apikey.ts
  - hosting/apps/gateway/src/tenant.ts
  - hosting/apps/gateway/src/tool-policy.ts
---

# ohmy-seo overview

TL;DR: ohmy-seo is a pnpm monorepo of local MCP servers and a hosted web cabinet plus gateway that brokers connected Yandex and Google accounts to MCP clients (`package.json:1-14`, `hosting/apps/gateway/src/runtime.ts:15-31`).

## Product shape

The repository contains independent MCP package workspaces under `packages/*`; pnpm declares that workspace glob and the root build runs each workspace build (`pnpm-workspace.yaml:1-3`, `package.json:8-13`). Local packages expose stdio MCP processes. The hosted web app manages login, account connections, and API keys; the gateway accepts Streamable HTTP MCP requests and starts package processes for the authenticated user's connected providers (`hosting/apps/web/src/app/app/page.tsx:1-20`, `hosting/apps/gateway/src/index.ts:48-153`, `hosting/apps/gateway/src/runtime.ts:95-153`).

The shared `@ohmy-seo/mcp-core` workspace provides package configuration, SQLite, OAuth, encryption, cache, HTTP, and error helpers used by MCP packages (`packages/core/package.json:5-32`, `packages/core/src/index.ts:1-7`). The three small packages documented at the root are Mutagen, Roistat, and XMLStock; package-specific docs for the larger workspaces own their internals (`packages/mutagen/package.json:1-22`, `packages/roistat/package.json:1-20`, `packages/xmlstock/package.json:1-20`).

## User entry points

- Local stdio: install dependencies, build a package, set its environment, then configure an MCP client to launch its `dist/index.js` (`package.json:8-13`, `packages/yandex-seo/package.json:5-14`).
- Hosted cabinet: sign in through the web app, connect provider accounts, and create a gateway API key (`hosting/apps/web/src/lib/actions.ts:1-30`, `hosting/apps/web/src/lib/apikey.ts:29-38`).
- Hosted MCP: send authenticated `POST /mcp` requests; the gateway authenticates the key, resolves the user's runtime, and serves tools (`hosting/apps/gateway/src/index.ts:48-99`).

## Boundaries

The web app owns the PostgreSQL schema. The gateway reads the same schema and materializes provider credentials into per-user SQLite files consumed by the local MCP packages (`hosting/apps/web/src/lib/db.ts:18-114`, `hosting/apps/gateway/src/tenant.ts:26-81`, `hosting/apps/gateway/src/tenant.ts:112-179`). The gateway's hosted tool policy is a separate allowlist and enforces confirmation for supported mutations (`hosting/apps/gateway/src/tool-policy.ts:4-49`, `hosting/apps/gateway/src/tool-policy.ts:74-118`).

See [architecture](architecture.md), [package map](packages.md), [deployment](deployment.md), and [data model map](data-model.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [ohmy-seo architecture](architecture.md)
- [ohmy-seo project map](project.md)

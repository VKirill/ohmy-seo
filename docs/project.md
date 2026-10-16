---
title: ohmy-seo project map
type: overview
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [project-map, monorepo]
sources:
  - package.json
  - pnpm-workspace.yaml
  - hosting/apps/gateway/src/runtime.ts
  - hosting/compose.yml
  - docs/architecture.md
  - packages/core/package.json
  - hosting/apps/web/src/lib/db.ts
  - hosting/deploy/angie/ohmy-seo.ru.conf
---

# ohmy-seo project map

TL;DR: This page routes maintainers to the system, package, deployment, and operations references; the root [PROJECT.md](../PROJECT.md) contains agent-facing entry points and invariants.

## Repository map

- `packages/*` contains local MCP workspaces, with shared infrastructure in `@ohmy-seo/mcp-core` (`pnpm-workspace.yaml:1-3`, `packages/core/package.json:5-32`).
- `hosting/apps/web` owns the account cabinet and hosted PostgreSQL schema; `hosting/apps/gateway` authenticates hosted MCP requests and starts selected package processes (`hosting/apps/web/src/lib/db.ts:18-114`, `hosting/apps/gateway/src/runtime.ts:22-39`).
- Docker Compose runs web, gateway, PostgreSQL, and Redis; Angie proxies public requests to loopback ports (`hosting/compose.yml:10-107`, `hosting/deploy/angie/ohmy-seo.ru.conf:1-80`).

## Where to look

- [System overview](overview.md) for product boundaries.
- [Architecture](architecture.md) for the C4 system diagram and hosted request sequence.
- [Small package reference](packages.md) for Mutagen, Roistat, and XMLStock.
- [Data model map](data-model.md) for hosted entities and workspace-owned data model links.
- [Deployment](deployment.md) and [hosting operations](../hosting/OPERATIONS.md) for builds, configuration, VPS operations, and releases.

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Workspace — Overview](../packages/google-ads/docs/overview.md)
- [Google Tag Manager workspace overview](../packages/gtm/docs/overview.md)
- [Yandex SEO workspace overview](../packages/yandex-seo/docs/overview.md)

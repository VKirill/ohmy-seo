---
title: ohmy-seo deployment
type: deployment
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [deployment, docker, pnpm]
sources:
  - package.json
  - pnpm-workspace.yaml
  - hosting/compose.yml
  - hosting/.env.example
  - hosting/apps/web/Dockerfile
  - hosting/apps/gateway/Dockerfile
  - hosting/deploy/angie/ohmy-seo.ru.conf
  - hosting/OPERATIONS.md
  - packages/yandex-seo/src/index.ts
  - packages/mutagen/src/index.ts
  - packages/yandex-seo/package.json
  - packages/ga4/package.json
  - hosting/apps/gateway/src/index.ts
  - hosting/apps/gateway/src/runtime.ts
  - hosting/apps/gateway/src/tool-policy.ts
  - hosting/apps/web/src/lib/providers.ts
---

# ohmy-seo deployment

TL;DR: Build local MCP packages with pnpm; the hosted web cabinet and MCP gateway run as separate Docker Compose services backed by PostgreSQL, Redis, and a tenant volume (`package.json:8-13`, `hosting/compose.yml:10-107`).

## Local MCP packages

1. Install the workspace with Node.js 22 or newer and pnpm, then build all packages with `pnpm install` and `pnpm -r build` (`package.json:8-14`).
2. Configure the environment required by the package startup validator (`packages/yandex-seo/src/index.ts:39-60`, `packages/mutagen/src/index.ts:36-95`). See the [Yandex workspace overview](../packages/yandex-seo/docs/overview.md) and [Mutagen package guide](packages.md#mutagen) for setup context.
3. Add the built `packages/<name>/dist/index.js` process to an MCP client. Package scripts define build and local development commands (`packages/yandex-seo/package.json:5-14`, `packages/ga4/package.json:5-14`).

## Hosted stack

The Compose project builds `web` from `hosting/apps/web` and `gateway` from `hosting/apps/gateway`; PostgreSQL and Redis are internal services, and the gateway persists materialized tenants in a named volume (`hosting/compose.yml:10-107`). Angie proxies public traffic to the loopback-bound web and gateway ports (`hosting/deploy/angie/ohmy-seo.ru.conf:1-80`).

| Service | Image build and process | Configuration and health |
|---|---|---|
| `web` | Multi-stage Docker build runs `npm ci`, `npm run build`, then starts Next standalone `server.js` as UID 1001 on port 3300 (`hosting/apps/web/Dockerfile:1-28`). | Compose injects `.env`, the master-key file, PostgreSQL `DATABASE_URL`, and `REDIS_URL`; healthcheck requests `/` (`hosting/compose.yml:30-55`, `hosting/apps/web/Dockerfile:22-28`). |
| `gateway` | Docker build clones `VKirill/ohmy-seo` at `OHMY_SEO_REF`, runs frozen pnpm install and workspace builds, compiles the Express gateway, then starts `dist/index.js` as UID 1001 on port 3301 (`hosting/apps/gateway/Dockerfile:1-47`). | Compose injects `.env`, master-key file, database/cache URLs, and persistent tenant volume; healthcheck requests `/healthz` (`hosting/compose.yml:57-88`, `hosting/apps/gateway/Dockerfile:36-47`). |
| `postgres` | `postgres:18-alpine`; persistent `pg_data` volume (`hosting/compose.yml:13-27`). | Healthcheck uses `pg_isready`; web and gateway wait for it to report healthy (`hosting/compose.yml:23-27`, `hosting/compose.yml:52-105`). |
| `redis` | `redis:8-alpine`; persistent `redis_data` volume (`hosting/compose.yml:28-42`). | Cache-only service with LRU eviction and a `redis-cli ping` healthcheck (`hosting/compose.yml:28-42`). |

1. Copy `hosting/.env.example` to the deployment `.env`; set public URLs, session/database secrets, provider OAuth credentials, and the master-key source file (`hosting/.env.example:1-48`).
2. Keep `OHMY_SEO_MASTER_KEY_SOURCE` as a Docker secret file. The web and gateway receive the mounted path as `OHMY_SEO_MASTER_KEY_FILE` (`hosting/compose.yml:40-51`, `hosting/compose.yml:72-87`).
3. Set `OHMY_SEO_REF` to the Git tag baked into the gateway image. The gateway Dockerfile clones the monorepo at that ref, installs workspace dependencies, and builds the selected MCP packages (`hosting/compose.yml:61-65`, `hosting/apps/gateway/Dockerfile:1-54`).
4. Build and start with `docker compose build web gateway && docker compose up -d`; Compose waits for healthy PostgreSQL and Redis before starting the web app and for web startup before gateway startup (`hosting/OPERATIONS.md:63-76`, `hosting/compose.yml:52-105`).
5. Verify `GET /healthz` and the hosted tool list from `POST /mcp`; `/healthz` reports database reachability, and the gateway waits for the web schema during startup (`hosting/apps/gateway/src/index.ts:25-32`, `hosting/apps/gateway/src/index.ts:164-185`).

## Hosted environment switches

| Variable | Effect | Evidence |
|---|---|---|
| `ENABLE_SHARED_SERP` | Enables platform-funded Mutagen and XMLStock child servers; default is false in the example environment. | `hosting/.env.example:25-28`, `hosting/apps/gateway/src/runtime.ts:34-39`, `hosting/apps/gateway/src/runtime.ts:53-56` |
| `OHMY_SEO_ALLOW_LIVE_MUTATIONS`, `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS` | Platform-level live-write switches; empty values make hosted write dispatch unavailable. | `hosting/.env.example:31-32`, `hosting/apps/gateway/src/tool-policy.ts:74-89`, `hosting/OPERATIONS.md:69-71` |
| `YANDEX_API_DIRECT_READY` | Controls whether Direct API connection configuration is considered production-ready by the web provider setup. | `hosting/.env.example:41-43`, `hosting/apps/web/src/lib/providers.ts:26-53` |
| `OHMY_SEO_REF` | Selects the source tag included in the gateway image. | `hosting/.env.example:37`, `hosting/apps/gateway/Dockerfile:1-8` |

The step-by-step VPS sync, tagging, backup, health, and operational commands are owned by [hosting operations](../hosting/OPERATIONS.md) and the root [ship protocol](../AGENTS.md).

<!-- lane-pilot:backlinks -->
## Referenced by

- [ohmy-seo architecture](architecture.md)
- [ohmy-seo overview](overview.md)
- [Small MCP packages](packages.md)
- [ohmy-seo project map](project.md)

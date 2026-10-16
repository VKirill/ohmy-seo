---
title: ohmy-seo gotchas
type: gotchas
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [gotchas, security, runtime]
sources:
  - hosting/apps/gateway/src/json-safe.ts
  - hosting/apps/gateway/src/index.ts
  - hosting/apps/gateway/src/tool-policy.ts
  - hosting/apps/gateway/src/runtime.ts
  - hosting/apps/gateway/src/tenant.ts
  - hosting/apps/web/src/lib/apikey.ts
  - hosting/apps/web/src/lib/connections.ts
  - hosting/compose.yml
  - hosting/OPERATIONS.md
  - hosting/.env.example
---

# ohmy-seo gotchas

TL;DR: Hosted behavior has separate authentication, tool allowlist, package process, and deployment boundaries; a package tool existing locally does not make it available in the cloud (`hosting/apps/gateway/src/tool-policy.ts:4-49`, `hosting/apps/gateway/src/runtime.ts:22-39`).

## Hosted MCP

- Use an API key in `Authorization: Bearer …` or `x-api-key`; the database stores the SHA-256 hash and the plaintext is returned only at creation (`hosting/apps/gateway/src/index.ts:34-44`, `hosting/apps/web/src/lib/apikey.ts:29-38`).
- The gateway is stateless at the HTTP transport layer. `GET /mcp` returns 405, `DELETE /mcp` returns 204, and each POST creates a new MCP server/transport (`hosting/apps/gateway/src/index.ts:48-49`, `hosting/apps/gateway/src/index.ts:88-99`, `hosting/apps/gateway/src/index.ts:150-157`).
- A tool is hosted only if it appears in the gateway's explicit read or write allowlist. SDK `readOnlyHint` annotations do not authorize it (`hosting/apps/gateway/src/tool-policy.ts:4-49`).
- Hosted writes require `confirm:true`. Generic Yandex API writes also require an exact `acknowledge_live` method/path value; Direct generic requests are constrained to POST v5/v501 JSON endpoints (`hosting/apps/gateway/src/tool-policy.ts:74-118`).
- Hosted image upload accepts base64 but rejects `file_path` and arbitrary URL input; video upload accepts exactly one Direct URL or `video_id` and rejects local files and base64 (`hosting/apps/gateway/src/tool-policy.ts:77-83`).
- JSON integer IDs outside JavaScript's safe integer range are parsed into strings. Keep Direct ad IDs as digit strings through clients and tool arguments (`hosting/apps/gateway/src/json-safe.ts:1-10`, `hosting/apps/gateway/src/json-safe.ts:19-78`).

## Tenant runtime and credentials

- Refresh tokens remain in PostgreSQL. The gateway materializes short-lived access tokens and placeholder refresh tokens into tenant SQLite files, then rewrites them as account tokens refresh (`hosting/apps/gateway/src/tenant.ts:112-179`).
- Connected accounts determine which provider packages start; Yandex Direct and unified Yandex API connections map to the Yandex package. Mutagen/XMLStock start only when `ENABLE_SHARED_SERP=true` (`hosting/apps/gateway/src/runtime.ts:49-56`).
- The runtime caps active tenants at 50 during startup, calls at 4 per user and 32 globally, and child tool calls time out after 120 seconds (`hosting/apps/gateway/src/runtime.ts:99-105`, `hosting/apps/gateway/src/runtime.ts:169-189`).
- Disconnecting accounts updates the materialized tenant on the next runtime synchronization; removed accounts are deleted from SQLite and the response cache is purged (`hosting/apps/gateway/src/runtime.ts:108-119`, `hosting/apps/gateway/src/tenant.ts:147-178`).

## Build and operations

- The hosted gateway image clones the monorepo at `OHMY_SEO_REF`. A Git push alone does not change the running image; deploy the hosting stack and rebuild the gateway at the intended tag (`hosting/apps/gateway/Dockerfile:1-8`, `hosting/compose.yml:61-65`, `hosting/OPERATIONS.md:58-62`).
- The gateway depends on the schema created by the web application. Startup retries schema discovery 30 times and then keeps the service running while requests fail if the schema never appears (`hosting/apps/gateway/src/index.ts:164-185`).
- The master encryption key is mounted as a Docker secret. Losing the key makes stored third-party tokens unrecoverable (`hosting/.env.example:7-12`, `hosting/OPERATIONS.md:27-38`).

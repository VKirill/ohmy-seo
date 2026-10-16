---
title: Small MCP packages
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [packages, mcp, mutagen, roistat, xmlstock]
sources:
  - packages/mutagen/package.json
  - packages/mutagen/src/index.ts
  - packages/mutagen/src/tools/mutagen-api.ts
  - packages/mutagen/src/tools/mutagen-competition.ts
  - packages/roistat/package.json
  - packages/roistat/src/index.ts
  - packages/roistat/src/client.ts
  - packages/xmlstock/package.json
  - packages/xmlstock/src/index.ts
  - packages/xmlstock/src/tools/xmlstock-yandex-serp.ts
  - packages/xmlstock/src/tools/xmlstock-google-serp.ts
  - packages/xmlstock/src/lib/xmlstock-archive.ts
  - packages/core/docs/overview.md
  - hosting/apps/gateway/src/runtime.ts
  - packages/mutagen/src/lib/mutagen-client.ts
  - packages/xmlstock/src/tools/xmlstock-usage-stats.ts
  - packages/xmlstock/src/lib/xmlstock-errors.ts
---

# Small MCP packages

TL;DR: Mutagen, Roistat, and XMLStock are independent stdio MCP packages that use `@ohmy-seo/mcp-core` for shared infrastructure; the hosted gateway optionally runs Mutagen and XMLStock as platform-funded services (`packages/mutagen/package.json:15-20`, `packages/roistat/package.json:15-18`, `packages/xmlstock/package.json:18-20`, `hosting/apps/gateway/src/runtime.ts:34-39`).

## Purpose

### Mutagen

MCP clients use `@ohmy-seo/mutagen` to request keyword competition and Mutagen API operations, including report requests and account checks (`packages/mutagen/src/index.ts:99-255`, `packages/mutagen/src/tools/mutagen-api.ts:37-76`, `packages/mutagen/src/tools/mutagen-competition.ts:5-23`).

### Roistat

MCP clients use `@ohmy-seo/roistat` to list Roistat projects, inspect analytics fields, and retrieve analytics data (`packages/roistat/src/index.ts:18-82`, `packages/roistat/src/index.ts:86-114`).

### XMLStock

MCP clients use `@ohmy-seo/xmlstock` to fetch Yandex and Google SERPs, inspect account usage, and search or retrieve archived XML responses (`packages/xmlstock/src/index.ts:121-194`, `packages/xmlstock/src/lib/xmlstock-archive.ts:68-100`).

## How it works

### Mutagen

1. Startup validates `MUTAGEN_API_KEY` and initializes package configuration before registering tools (`packages/mutagen/src/index.ts:36-95`, `packages/mutagen/src/index.ts:270-280`).
2. The competition tool submits phrases through the Mutagen client and applies the package cache (`packages/mutagen/src/tools/mutagen-competition.ts:5-23`).
3. `mutagen_api` validates the method, detects typo variants, calls the client, and returns structured JSON (`packages/mutagen/src/tools/mutagen-api.ts:19-76`).

| Mode | Inputs | Output / constraints |
|---|---|---|
| Competition | Phrase list | Competition scores and API data; depends on Mutagen API response (`packages/mutagen/src/tools/mutagen-competition.ts:5-23`). |
| Generic API | API method and optional params | API gateway response; method dispatch selects GET or POST behavior (`packages/mutagen/src/lib/mutagen-client.ts:46-125`). |

Failures: missing credentials fail configuration validation; upstream HTTP/API errors are normalized by the client and returned as tool errors (`packages/mutagen/src/index.ts:36-95`, `packages/mutagen/src/lib/mutagen-client.ts:66-125`).

### Roistat

1. Startup validates the API key and optional project setting, then starts the stdio MCP server (`packages/roistat/src/index.ts:84-125`).
2. The package maps three named tools to fixed API methods and converts responses to text or JSON (`packages/roistat/src/index.ts:23-82`).
3. The client keeps the API key out of the request URL and formats provider errors (`packages/roistat/src/client.ts:13-75`).

| Mode | Input | Output |
|---|---|---|
| List projects | No project required | Available Roistat projects (`packages/roistat/src/index.ts:25-37`). |
| List analytics fields | Optional project selection | Metrics, dimensions, attribution models (`packages/roistat/src/index.ts:39-60`). |
| Analytics report | Project and report parameters | `/project/analytics/data` result (`packages/roistat/src/index.ts:62-82`). |

Failures: missing API key fails client configuration; upstream errors are formatted by `formatRoistatError` (`packages/roistat/src/client.ts:13-22`, `packages/roistat/src/client.ts:64-75`).

### XMLStock

1. Startup validates XMLStock credentials and package encryption configuration (`packages/xmlstock/src/index.ts:61-120`, `packages/xmlstock/src/index.ts:211-221`).
2. SERP tools canonicalize inputs, check the shared cache, call the provider client on a miss, and return parsed results (`packages/xmlstock/src/tools/xmlstock-yandex-serp.ts:25-112`, `packages/xmlstock/src/tools/xmlstock-google-serp.ts:25-115`).
3. The archive layer stores raw responses with metadata and hashes, then supports search and retrieval (`packages/xmlstock/src/lib/xmlstock-archive.ts:55-100`, `packages/xmlstock/src/lib/xmlstock-archive.ts:110-197`).

| Mode | Inputs | Output |
|---|---|---|
| Yandex SERP | Query and Yandex region/device parameters | Normalized results and archive metadata (`packages/xmlstock/src/tools/xmlstock-yandex-serp.ts:25-112`). |
| Google SERP | Query and Google locale/device parameters | Normalized results and archive metadata (`packages/xmlstock/src/tools/xmlstock-google-serp.ts:25-115`). |
| Usage statistics | No query | Account usage counters (`packages/xmlstock/src/tools/xmlstock-usage-stats.ts:9-26`). |

Failures: missing credentials stop startup; upstream response errors are classified and returned with provider error metadata (`packages/xmlstock/src/index.ts:61-120`, `packages/xmlstock/src/lib/xmlstock-errors.ts:160-172`).

## Business rules

- Mutagen requires `MUTAGEN_API_KEY` and does not use provider OAuth accounts (`packages/mutagen/src/index.ts:36-51`, `packages/mutagen/src/lib/mutagen-client.ts:5-45`).
- Roistat calls a fixed allowlist of read methods; it does not expose a generic endpoint parameter or write operation (`packages/roistat/src/index.ts:23-82`).
- XMLStock archives raw XML with a content hash, and exact retrieval resolves the archive row by ID (`packages/xmlstock/src/lib/xmlstock-archive.ts:55-67`, `packages/xmlstock/src/lib/xmlstock-archive.ts:167-197`).

## Public API or commands

- Mutagen tools: `mutagen_competition`, `mutagen_api`, plus parser and SERP report tools registered by the package entry (`packages/mutagen/src/index.ts:99-255`). Commands: `pnpm --filter @ohmy-seo/mutagen build`, `dev`, and `start` (`packages/mutagen/package.json:8-14`).
- Roistat tools: `roistat_list_projects`, `roistat_list_analytics_fields`, and `roistat_get_analytics` (`packages/roistat/src/index.ts:23-82`). Commands: `pnpm --filter @ohmy-seo/roistat build` and `dev` (`packages/roistat/package.json:8-14`).
- XMLStock tools: `xmlstock_yandex_serp`, `xmlstock_google_serp`, `xmlstock_usage_stats`, and archive tools registered by the package entry (`packages/xmlstock/src/index.ts:121-194`). Commands: `pnpm --filter @ohmy-seo/xmlstock build`, `dev`, and `smoke` (`packages/xmlstock/package.json:8-16`).

## Gotchas

- Hosted Mutagen and XMLStock are platform-funded and start only when `ENABLE_SHARED_SERP=true` (`hosting/apps/gateway/src/runtime.ts:34-39`, `hosting/apps/gateway/src/runtime.ts:58-94`).
- `ROISTAT_PROJECT_ID` is optional for project listing and required by project-specific API methods unless provided in tool input (`packages/roistat/src/client.ts:23-30`, `packages/roistat/src/index.ts:39-82`).

## Related pages

- [Shared core overview](../packages/core/docs/overview.md)
- [System architecture](architecture.md)
- [Deployment](deployment.md)

<!-- lane-pilot:backlinks -->
## Referenced by

- [ohmy-seo architecture](architecture.md)
- [ohmy-seo deployment](deployment.md)
- [ohmy-seo overview](overview.md)
- [ohmy-seo project map](project.md)

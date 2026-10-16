---
title: Public website and search metadata
type: component
created: 2026-09-14
updated: 2026-10-16
status: active
confidence: high
tags: [website, seo, marketing]
sources:
  - hosting/apps/web/src/app/page.tsx
  - hosting/apps/web/src/app/integrations/[slug]/page.tsx
  - hosting/apps/web/src/app/prompts/page.tsx
  - hosting/apps/web/src/lib/marketing/catalog.ts
  - hosting/apps/web/src/lib/marketing/prompts.ts
  - hosting/apps/web/src/lib/marketing/seo.ts
  - hosting/apps/web/src/app/sitemap.ts
  - hosting/apps/web/src/app/robots.ts
  - hosting/apps/web/src/app/layout.tsx
  - hosting/apps/web/src/lib/marketing/clients.ts
---

# Public website and search metadata

TL;DR: The Next.js marketing site generates the home page, integration pages, MCP instructions, and prompt library from shared data modules and emits per-page canonical, social, and structured metadata (`hosting/apps/web/src/app/page.tsx:1-15`, `hosting/apps/web/src/app/integrations/[slug]/page.tsx:9-16`, `hosting/apps/web/src/app/prompts/page.tsx:6-17`).

## Purpose

Public pages explain the supported services, provide integration-specific capabilities and prompts, and route visitors to connection or installation instructions (`hosting/apps/web/src/app/page.tsx:17-28`, `hosting/apps/web/src/app/integrations/[slug]/page.tsx:17-25`).

## How it works

1. The home page imports the integration catalog, client instructions, and shared social metadata. Its sections link into integration pages, prompts, connection, and MCP setup (`hosting/apps/web/src/app/page.tsx:1-15`, `hosting/apps/web/src/app/page.tsx:17-28`).
2. The integration route statically generates one route per catalog slug, derives page metadata from that catalog record, returns not-found for unknown slugs, and renders capabilities, sample prompts, tool names, requirements, and limitations (`hosting/apps/web/src/app/integrations/[slug]/page.tsx:9-25`).
3. The prompt library derives its count and categories from prompt data. A `service` query parameter selects a category; an unknown category falls back to the first category (`hosting/apps/web/src/app/prompts/page.tsx:6-17`).
4. Shared SEO helpers generate canonical site URLs, Open Graph/Twitter metadata, and Schema.org page graphs. The root layout sets the metadata base and site graph (`hosting/apps/web/src/lib/marketing/seo.ts:3-17`, `hosting/apps/web/src/lib/marketing/seo.ts:19-40`, `hosting/apps/web/src/app/layout.tsx:7-13`).
5. The sitemap lists the home, MCP instructions, prompt library, and every integration catalog route; robots metadata disallows `/app` and `/api/` (`hosting/apps/web/src/app/sitemap.ts:1-5`, `hosting/apps/web/src/app/robots.ts:1-4`).

| Page mode | Data source | Distinguishing behavior |
|---|---|---|
| Home `/` | Integration catalog and client guide modules | Presents scenarios, service list, prompts, setup, and access information (`hosting/apps/web/src/app/page.tsx:7-28`). |
| Integration `/integrations/[slug]` | `integrations` catalog | Static params; per-item title/description/canonical; unknown slugs return 404 (`hosting/apps/web/src/app/integrations/[slug]/page.tsx:9-20`). |
| Prompt library `/prompts` | Prompt categories and count | Server-selected service tab; invalid service selects the first category (`hosting/apps/web/src/app/prompts/page.tsx:6-17`). |
| MCP instructions `/claude-mcp` | Client guide module | Client-specific instructions are stored as guide records (`hosting/apps/web/src/lib/marketing/clients.ts:24-40`). |

Failures: an unknown integration slug returns not-found and metadata marks the unknown route `noindex`; invalid prompt category is handled by selecting the first category (`hosting/apps/web/src/app/integrations/[slug]/page.tsx:11-20`, `hosting/apps/web/src/app/prompts/page.tsx:14-16`).

## Business rules

Public integration content is catalog-driven; service names, tool examples, prompts, access requirements, and limitations are stored together in `catalog.ts` (`hosting/apps/web/src/lib/marketing/catalog.ts:1-25`). Prompt metadata derives the number of available examples from `promptCount` (`hosting/apps/web/src/app/prompts/page.tsx:6-12`).

## Public API or commands

Routes: `/`, `/integrations/[slug]`, `/prompts`, `/claude-mcp`, `/privacy`, and `/connect`. Sitemap includes `/`, `/prompts`, `/claude-mcp`, and each catalog integration (`hosting/apps/web/src/app/sitemap.ts:1-5`).

## Gotchas

`robots.txt` disallows crawling `/app` and `/api/`; this is crawl guidance, not route authorization (`hosting/apps/web/src/app/robots.ts:1-4`). Canonicals use the site URL constant `https://ohmy-seo.ru` (`hosting/apps/web/src/lib/marketing/seo.ts:3-5`).

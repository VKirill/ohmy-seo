---
title: Google Ads Reads and Reports
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-ads, gaql, reporting]
sources:
  - packages/google-ads/src/index.ts
  - packages/google-ads/src/lib/ads-runner.ts
  - packages/google-ads/src/lib/ads-client.ts
  - packages/google-ads/src/lib/gaql-builder.ts
  - packages/google-ads/src/tools/ads-run-query.ts
  - packages/google-ads/src/tools/ads-campaign-performance-report.ts
  - packages/google-ads/src/tools/ads-search-terms-report.ts
---

# Google Ads Reads and Reports

**TL;DR:** Read tools resolve an authorized Google Ads account, execute GAQL or a metadata query, optionally cache successful results, and return formatted MCP text.

## Purpose

The read capability covers accessible customers, customer details, campaigns and related resources, GAQL field metadata, raw GAQL, performance reports, change history, and recommendations (`packages/google-ads/src/index.ts:235-393`).

## How it works

1. The MCP schema validates the tool inputs, including customer IDs, filters, date range strings, and optional `force_refresh` flags (`packages/google-ads/src/index.ts:132-147`, `packages/google-ads/src/index.ts:235-393`).
2. GAQL-backed tools resolve the named or default account and require the Ads API scope; customer IDs are normalized to digits (`packages/google-ads/src/lib/ads-runner.ts:46-53`).
3. `runGaqlTool` calls `withCache` using tool name, account ID, normalized customer ID, query, and manager ID. Failed results bypass cache (`packages/google-ads/src/lib/ads-runner.ts:54-69`).
4. The client posts to `customers/{id}/googleAds:searchStream`, flattens result chunks, and adds readable decimal fields for recognized micros-valued fields (`packages/google-ads/src/lib/ads-client.ts:363-405`, `packages/google-ads/src/lib/ads-client.ts:155-172`).
5. The runner serializes result rows, count, query, optional manager and warnings into one MCP text item. Responses longer than 25,000 characters are cut and include a narrowing hint (`packages/google-ads/src/lib/ads-runner.ts:12-29`, `packages/google-ads/src/lib/ads-runner.ts:75-86`).
6. Metadata calls use the Google Ads fields service, which does not require a customer path or GAQL `FROM` clause (`packages/google-ads/src/lib/ads-client.ts:342-361`).

### Modes

| Mode | Tools | Behavior and limits | Evidence |
|---|---|---|---|
| Entity reads | `ads_list_accessible_customers`, `ads_get_customer`, `ads_list_campaigns`, `ads_list_ad_groups`, `ads_list_ads`, `ads_list_keywords`, `ads_list_negative_keywords`, `ads_list_budgets`, `ads_list_shared_sets` | Reads customer access, settings, campaign entities and budgets; selected calls accept filters. Most entity reads use the report cache TTL. | `packages/google-ads/src/index.ts:237-314`, `packages/google-ads/src/index.ts:63-81` |
| Raw query | `ads_run_query` | Accepts one GAQL SELECT query; appends the supplied/default limit if absent and appends resource-name omission parameters. | `packages/google-ads/src/index.ts:319-328`, `packages/google-ads/src/lib/gaql-builder.ts:107-151` |
| Resource metadata | `ads_resource_metadata` | Returns resource fields, metrics, and segments through `GoogleAdsFieldService`; metadata cache TTL applies. | `packages/google-ads/src/index.ts:330-338`, `packages/google-ads/src/lib/ads-client.ts:342-361` |
| Reports and history | `ads_search_terms_report`, `ads_keyword_performance_report`, `ads_campaign_performance_report`, `ads_change_history` | Structured report inputs build GAQL; change history accepts a days window capped by the tool at 30 days. | `packages/google-ads/src/index.ts:340-382` |
| Recommendations | `ads_recommendations` | Lists recommendation resources and projected impact; a returned resource name can be passed to the write tool `ads_apply_recommendation`. | `packages/google-ads/src/index.ts:384-393` |

## Business rules

- Date range helpers accept the enumerated GAQL `DURING` values or an explicit `YYYY-MM-DD..YYYY-MM-DD` range; other strings raise `GaqlError` (`packages/google-ads/src/lib/gaql-builder.ts:11-27`, `packages/google-ads/src/lib/gaql-builder.ts:75-89`).
- Raw GAQL must be one SELECT statement with FROM; semicolons, OFFSET, and missing required primary fields are rejected. Missing LIMIT is filled with the configured default (`packages/google-ads/src/lib/gaql-builder.ts:101-151`).
- Raw queries selecting metrics without a date predicate get a warning that Google returns lifetime totals; this is not a rejection (`packages/google-ads/src/lib/gaql-builder.ts:130-137`).
- Recognized micros values get a sibling readable currency field rounded to two decimal places after division by 1,000,000 (`packages/google-ads/src/lib/ads-client.ts:155-172`).
- A configured manager account is retried only when no explicit manager was passed and the first response contains a permission problem (`packages/google-ads/src/lib/ads-client.ts:198-214`).

## Public API

All listed calls are MCP tools. Common inputs include optional `account`, customer ID, optional `login_customer_id`, and `force_refresh`; tool-specific parameters are shown in `src/index.ts` (`packages/google-ads/src/index.ts:235-393`).

| Tool | Purpose |
|---|---|
| `ads_list_accessible_customers` | List accessible customer accounts and manager tree. |
| `ads_get_customer` | Read currency, time zone, manager flag, and auto-tagging. |
| `ads_list_campaigns` | List campaigns and associated configuration. |
| `ads_list_ad_groups` | List ad groups, optionally filtered to a campaign. |
| `ads_list_ads` | List ads, optionally filtered to an ad group or campaign. |
| `ads_list_keywords` | List positive keywords and quality score fields. |
| `ads_list_negative_keywords` | List negative keywords at campaign or ad-group level. |
| `ads_list_budgets` | List budgets and associated campaign counts. |
| `ads_list_shared_sets` | List shared negative keyword sets and optionally campaign attachments. |
| `ads_run_query` | Validate and run a caller-provided GAQL query. |
| `ads_resource_metadata` | Inspect available fields for a GAQL resource. |
| `ads_search_terms_report` | Report on actual search terms with optional zero-conversion filter. |
| `ads_keyword_performance_report` | Report keyword performance and quality score components. |
| `ads_campaign_performance_report` | Report campaign metrics and impression share. |
| `ads_change_history` | Read change events from the API's available history window. |
| `ads_recommendations` | List Google recommendations. |

## Package shape

- `src/tools/ads-*-report.ts`, `ads-run-query.ts`, `ads-resource-metadata.ts`, and `ads-list-*` hold tool-specific query construction.
- `src/lib/gaql-builder.ts` provides date clauses, query construction, and raw-query checks.
- `src/lib/ads-runner.ts` resolves accounts, wraps successful calls in cache, and formats MCP responses.
- `src/lib/ads-client.ts` performs Google Ads requests and normalizes results (`packages/google-ads/src/index.ts:24-38`, `packages/google-ads/src/lib/ads-runner.ts:42-86`).

## Internal model

Structured tools build GAQL from fixed field lists and validated options. Raw GAQL shares the same request runner but passes through a preflight validator. Metadata requests use a separate Google Ads fields endpoint because that service has a different query shape (`packages/google-ads/src/lib/gaql-builder.ts:61-73`, `packages/google-ads/src/tools/ads-run-query.ts:10-37`, `packages/google-ads/src/lib/ads-client.ts:342-377`).

Cache identity includes the account ID, tool name, normalized customer ID, query, and manager ID, while `force_refresh` bypasses a cached value (`packages/google-ads/src/lib/ads-runner.ts:54-69`).

## Dependencies

The feature relies on `@ohmy-seo/mcp-core` for Google OAuth token acquisition, HTTP errors, result caching, and MCP error shaping (`packages/google-ads/src/lib/ads-client.ts:1-10`, `packages/google-ads/src/lib/ads-runner.ts:1-5`).

## Gotchas

- The metadata query omits `FROM`, unlike standard GAQL queries, because it uses `GoogleAdsFieldService` (`packages/google-ads/src/lib/ads-client.ts:342-353`).
- The API returns micros; readable sibling fields are added, but original values remain in the payload (`packages/google-ads/src/lib/ads-client.ts:155-172`).
- `force_refresh` is a cache control for the current read and does not alter the query or Google Ads state (`packages/google-ads/src/lib/ads-runner.ts:54-69`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Workspace — Overview](../overview.md)

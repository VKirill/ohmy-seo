---
title: Yandex Direct operations
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, yandex-direct, campaigns]
sources:
  - packages/yandex-seo/src/index.ts
  - packages/yandex-seo/src/lib/api-gateway.ts
  - packages/yandex-seo/src/tools/direct-set-placements.ts
  - packages/yandex-seo/src/registry/direct-read.ts
  - packages/yandex-seo/src/registry/direct-read-extra.ts
  - packages/yandex-seo/src/registry/direct-write.ts
  - packages/yandex-seo/src/lib/api/confirm-gate.ts
  - packages/yandex-seo/src/lib/payload-builder.ts
  - packages/yandex-seo/src/lib/epk-settings.ts
  - packages/yandex-seo/src/lib/ad-id.ts
---
# Yandex Direct operations

TL;DR: Specialized Direct tools read campaign data and perform campaign, ad, budget, targeting, and bid edits, with live mutations protected by environment flags and explicit confirmations (`packages/yandex-seo/src/registry/direct-read.ts:14-28`, `packages/yandex-seo/src/registry/direct-write.ts:27-62`, `packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).

## Purpose

This capability provides named operations for common Direct tasks and a constrained set of campaign workflows. The server instructions describe its campaign model as combinatorial EPK and call out campaign details, ad groups, ads, statistics, history, moderation, bidding, adjustments, placements, feeds, and Metrika linkage (`packages/yandex-seo/src/index.ts:23-35`).

## How it works

1. Each tool registers a Zod input schema and calls a typed `run...` handler; read and write tool groups are registered separately (`packages/yandex-seo/src/registry/direct-read.ts:14-28`, `packages/yandex-seo/src/registry/direct-write.ts:27-62`).
2. Tool handlers resolve an account and build API payloads for Direct methods; the payload modules encode Direct field names and structured settings (`packages/yandex-seo/src/lib/payload-builder.ts:1-26`, `packages/yandex-seo/src/lib/epk-settings.ts:66-125`).
3. Mutating handlers invoke the confirmation gate, which requires both live-mutation env flags, any operation-specific flag, `confirm: true`, and exact acknowledgement text (`packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).
4. The handler sends the API request and returns the API result or a normalized tool error; one operation's policy depends on its tool-specific wrapper and schema (`packages/yandex-seo/src/registry/direct-write.ts:27-62`, `packages/yandex-seo/src/tools/direct-set-placements.ts:1-80`).

### Modes

| Tool family | Inputs and limits | Output or state change | Evidence |
|---|---|---|---|
| Read | Campaign IDs, selection filters, report parameters, or entity IDs | Campaign, ad group, ad, keyword, search-term, statistics, and change-history data | `packages/yandex-seo/src/registry/direct-read.ts:14-68,127-190,255-329,391-448` |
| Point edits | Selected IDs and typed update payloads | Changes to campaign, ad group, ad, budgets, placements, modifiers, or negative keywords | `packages/yandex-seo/src/registry/direct-write.ts:27-186,392-596` |
| Account IDs | IDs at or above JavaScript's unsafe integer range | Must be passed as digit strings and remain strings through payload construction | `packages/yandex-seo/src/lib/ad-id.ts:1-11`, `packages/yandex-seo/src/lib/api-gateway.ts:59-78` |
| Live mutation | `confirm`, exact `acknowledge_live`, global and platform env flags | API mutation proceeds only after all checks pass | `packages/yandex-seo/src/lib/api/confirm-gate.ts:23-67` |

### Failures

- Missing environment flags, `confirm: true`, or exact acknowledgement throws a `ConfirmGateError` with a specific code (`packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).
- A JSON number already rounded outside the safe integer range is rejected; the original exact ID cannot be recovered in the gateway (`packages/yandex-seo/src/lib/api-gateway.ts:59-78`).
- Direct API errors surface through the tool result or typed auth/rate-limit error paths (`packages/yandex-seo/src/lib/api-gateway.ts:120-132`).
- Placement updates reject disabling all placements and preserve strategy parameters, as enforced by the placement tool handler (`packages/yandex-seo/src/tools/direct-set-placements.ts:1-80`).

## Business rules

- The live gate requires `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` and `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true`; delete-like operations can add another flag (`packages/yandex-seo/src/lib/api/confirm-gate.ts:33-52`).
- Confirmation is literal: `confirm` must be boolean `true` and `acknowledge_live` must exactly match the expected string (`packages/yandex-seo/src/lib/api/confirm-gate.ts:54-67`).
- IDs too large for a safe JavaScript integer must be represented as strings to preserve all digits (`packages/yandex-seo/src/lib/ad-id.ts:4-11`, `packages/yandex-seo/src/lib/api-gateway.ts:59-78`).
- EPK settings map supported adjustment scopes to Direct payload fields, including explicit array-valued regional, demographic, and retargeting adjustments (`packages/yandex-seo/src/lib/epk-settings.ts:66-125`).

## Public API

| MCP tool groups | Registration | Purpose |
|---|---|---|
| Read and reporting tools | `packages/yandex-seo/src/registry/direct-read.ts:15-456`, `packages/yandex-seo/src/registry/direct-read-extra.ts:11-83` | `yandex_direct_list_campaigns`, `yandex_direct_list_adgroups`, `yandex_direct_list_ads`, `yandex_direct_list_keywords`, `yandex_direct_get_stats`, `yandex_direct_get_change_history`, `yandex_direct_get_search_terms`, `yandex_direct_render_to_xlsx`, `yandex_direct_get_campaign_details` |
| Write tools | `packages/yandex-seo/src/registry/direct-write.ts:28-1011` | `yandex_direct_upload_image`, `yandex_direct_upload_video`, `yandex_direct_create_campaign`, `yandex_direct_create_adgroup`, `yandex_direct_create_ad_unified`, `yandex_direct_link_metrika_goals`, `yandex_direct_pause_campaigns`, `yandex_direct_resume_campaigns`, `yandex_direct_moderate_ads`, `yandex_direct_delete_campaigns`, `yandex_direct_negative_keywords_add`, `yandex_direct_update_budgets`, `yandex_direct_create_sitelinks_set`, `yandex_direct_create_promo_extension`, `yandex_direct_update_adgroup_autotargeting`, `yandex_direct_set_bid_modifiers`, `yandex_direct_update_campaign`, `yandex_direct_set_placements`, `yandex_direct_update_adgroup`, `yandex_direct_update_ad`, `yandex_direct_feeds` |

Specific tool names and schemas are declared inline in the cited registries; the generic endpoint option is documented on [API gateways](api-gateways.md).

## Package shape

- `src/registry/direct-read*.ts` and `src/registry/direct-write.ts` define MCP interfaces.
- `src/tools/direct-*.ts` implement calls.
- `src/lib/payloads/` and `src/lib/epk-settings.ts` shape Direct payloads.
- `src/lib/api/confirm-gate.ts` enforces live mutation acknowledgement.

## Internal model

Specialized tools wrap the underlying API to accept narrower typed inputs and construct request bodies. The payload builder parses campaign input and assembles Direct campaign and group payloads; EPK settings map additional campaign configuration to API fields (`packages/yandex-seo/src/lib/payload-builder.ts:1-26`, `packages/yandex-seo/src/lib/epk-settings.ts:58-125`).

## Dependencies

The Direct features call shared account, token, HTTP, and error services through the API gateway and core package (`packages/yandex-seo/src/lib/api-gateway.ts:1-9`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex SEO workspace overview](../overview.md)

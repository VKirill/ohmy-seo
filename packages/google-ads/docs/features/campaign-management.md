---
title: Google Ads Campaign Management
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [google-ads, mutations, campaigns]
sources:
  - packages/google-ads/src/index.ts
  - packages/google-ads/src/lib/ads-mutate.ts
  - packages/google-ads/src/lib/confirm-gate.ts
  - packages/google-ads/src/lib/ads-client.ts
  - packages/google-ads/src/tools/ads-create-ad.ts
  - packages/google-ads/src/tools/ads-create-campaign.ts
  - packages/google-ads/src/tools/ads-create-ad-group.ts
  - packages/google-ads/src/tools/ads-add-keywords.ts
---

# Google Ads Campaign Management

**TL;DR:** Mutation tools turn requested changes into Google Ads operations, return a preview by default, and gate live writes through explicit confirmation and an environment switch.

## Purpose

This capability creates, updates, enables, pauses, removes, or links Google Ads resources. Mutations share one executor that shapes previews, checks live-operation gates, resolves the Ads account, calls the API, and invalidates cached reads after a successful live write (`packages/google-ads/src/lib/ads-mutate.ts:57-64`, `packages/google-ads/src/lib/ads-mutate.ts:97-127`).

## How it works

1. A tool validates its inputs and creates the Google Ads API operation objects. Creation tools set new campaigns, ad groups, keywords, and ads to paused defaults (`packages/google-ads/src/index.ts:395-500`).
2. The tool calls `runMutation` with its operation name, target and change preview, API endpoint, and operations (`packages/google-ads/src/lib/ads-mutate.ts:35-55`).
3. Without `confirm:true`, the executor returns a dry-run object containing operation, target, proposed change, operation payload, and next-step text; it does not call Google (`packages/google-ads/src/lib/ads-mutate.ts:64-76`).
4. A confirmed call is blocked unless `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true`, except `validate_only` calls (`packages/google-ads/src/lib/ads-mutate.ts:78-88`).
5. DANGER operations also require the exact string `I-UNDERSTAND-THIS-IS-LIVE:<digits-only customer ID>:<resource path>` (`packages/google-ads/src/lib/ads-mutate.ts:90-95`, `packages/google-ads/src/lib/confirm-gate.ts:44-60`).
6. The executor resolves an account with the Ads scope and sends a POST with `partialFailure:false`; `validate_only:true` adds Google's `validateOnly` flag (`packages/google-ads/src/lib/ads-mutate.ts:97-111`).
7. API errors return an MCP error result with `applied:false`. A successful live write invalidates the account's cached read results; a validation-only success reports `validated_only:true` and does not invalidate reads (`packages/google-ads/src/lib/ads-mutate.ts:113-127`, `packages/google-ads/src/lib/ads-mutate.ts:133-141`).

### Modes

| Mode | Tools | Inputs and output differences | Failure behavior |
|---|---|---|---|
| Preview | Every mutation with `confirm` omitted or false | Returns target and proposed change without a Google Ads API write; `next_step` explains the required confirmation. | No API failure is possible because no write request is sent. |
| Validate only | Non-DANGER mutation with `confirm:true` and `validate_only:true` | Sends a Google validation request with `validateOnly:true`; successful result has `validated_only:true` and `applied:false`. | Requires account resolution and Google validation; failures return an MCP error. |
| Confirmed live mutation | Non-DANGER mutation with `confirm:true`, `validate_only` false, and live-mutation environment gate enabled | Sends operation to Google; successful live writes invalidate cached read results. | Missing env gate returns an error explaining how to enable; Google API errors return `applied:false`. |
| DANGER live mutation | DANGER tool with `confirm:true`, exact target acknowledgement, and live-mutation environment gate enabled | Intended for campaign enable/pause, budget changes, recommendation application, removals, and detach shared-set operation. | Missing or mismatched acknowledgement throws and is converted to MCP error content; missing env gate blocks the call. |

Implementation evidence for preview, environment gate, DANGER acknowledgement, validation mode, API response handling, and cache invalidation: `packages/google-ads/src/lib/ads-mutate.ts:64-141`.

## Business rules

- `confirm:true` is required before every mutation is sent for Google validation or writing; the default is preview-only (`packages/google-ads/src/lib/ads-mutate.ts:69-76`).
- Live writes require `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true`; `validate_only` requests bypass this environment gate (`packages/google-ads/src/lib/ads-mutate.ts:78-88`).
- DANGER acknowledgement must match the normalized customer ID and resource path exactly after trimming (`packages/google-ads/src/lib/ads-mutate.ts:90-95`, `packages/google-ads/src/lib/confirm-gate.ts:44-60`).
- Create campaign forces `PAUSED`, and create ad group, keyword, and responsive search ad tools default to disabled state (`packages/google-ads/src/tools/ads-create-campaign.ts:43-50`, `packages/google-ads/src/tools/ads-create-ad-group.ts:17-31`, `packages/google-ads/src/tools/ads-add-keywords.ts:25-42`, `packages/google-ads/src/tools/ads-create-ad.ts:157-170`).
- Responsive search ad assets must include 3–15 headlines (30 characters each), 2–4 descriptions (90 characters each), no duplicate text, allowed pin positions, and valid display paths (`packages/google-ads/src/tools/ads-create-ad.ts:34-81`, `packages/google-ads/src/tools/ads-create-ad.ts:115-153`).
- Confirmed campaign renames update the name only; campaign enablement and pause are separate DANGER tools (`packages/google-ads/src/index.ts:514-522`, `packages/google-ads/src/index.ts:547-563`).
- Successful live writes clear cached results for the account across the registered read tool set; cache deletion errors do not change a successful mutation result (`packages/google-ads/src/lib/ads-mutate.ts:16-33`, `packages/google-ads/src/lib/ads-mutate.ts:133-141`).

## Public API

These are MCP tools registered by `src/index.ts`; each write defaults to preview mode as described above (`packages/google-ads/src/index.ts:395-622`).

| Tool | Operation |
|---|---|
| `ads_create_campaign_budget` | Create daily campaign budget. |
| `ads_create_campaign` | Create campaign with selected channel and bidding strategy. |
| `ads_add_campaign_criteria` | Add location, excluded-location, and language criteria. |
| `ads_create_ad_group` | Create an ad group. |
| `ads_add_keywords` | Add positive keywords to an ad group. |
| `ads_add_negative_keywords` | Add campaign- or ad-group-level negative keywords. |
| `ads_create_ad` | Create a responsive search ad after local asset validation. |
| `ads_update_ad_group` | Update an ad group name, status, or CPC bid. |
| `ads_update_campaign` | Rename a campaign. |
| `ads_attach_shared_set` | Attach a shared negative keyword set to a campaign. |
| `ads_apply_recommendation` | Apply a Google recommendation. |
| `ads_enable_campaign` | Enable a campaign. |
| `ads_pause_campaign` | Pause a campaign. |
| `ads_update_budget` | Change a budget's daily amount. |
| `ads_remove_keywords` | Remove positive keywords by criterion IDs. |
| `ads_remove_negative_keywords` | Remove negative keywords by criterion IDs. |
| `ads_remove_ads` | Remove ads by ad IDs. |
| `ads_remove_campaign` | Remove a campaign. |
| `ads_detach_shared_set` | Detach a shared negative set from a campaign. |

## Package shape

- `src/tools/ads-create-*`, `ads-add-*`, and `ads-update-*` construct resource mutations.
- `src/tools/ads-enable-campaign.ts`, `ads-pause-campaign.ts`, `ads-update-budget.ts`, `ads-remove-*`, and `ads-detach-shared-set.ts` implement DANGER mutations.
- `src/lib/ads-mutate.ts` is the shared execution and invalidation path; `src/lib/confirm-gate.ts` formats and validates confirmation (`packages/google-ads/src/index.ts:39-60`, `packages/google-ads/src/lib/ads-mutate.ts:57-64`).

## Internal model

Each tool maps its semantic inputs to Google Ads mutation operations. The shared executor receives these operations alongside a separate preview representation, so the preview describes intent without exposing an implementation-specific API call as the only explanation (`packages/google-ads/src/lib/ads-mutate.ts:35-55`, `packages/google-ads/src/lib/ads-mutate.ts:69-76`).

The executor sets `partialFailure:false`, so the request does not opt into per-operation partial success. It reports API errors as `applied:false` and only clears read cache after a successful non-validation write (`packages/google-ads/src/lib/ads-mutate.ts:99-127`).

## Dependencies

Mutations use the shared Google Ads client, account resolver, cache package, Google OAuth scope constant, and MCP error formatter (`packages/google-ads/src/lib/ads-mutate.ts:1-12`).

## Gotchas

- `validate_only:true` still needs `confirm:true`, but does not need the live-mutation environment switch (`packages/google-ads/src/lib/ads-mutate.ts:69-88`).
- A preview is not a Google-side validation result; Google validation happens only after `confirm:true` takes the API-call path (`packages/google-ads/src/lib/ads-mutate.ts:69-111`).
- `ads_detach_shared_set` is DANGER because it widens matching, while attaching a shared set is a non-DANGER mutation (`packages/google-ads/src/index.ts:524-544`, `packages/google-ads/src/index.ts:614-622`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Google Ads Workspace Gotchas](../gotchas.md)
- [Google Ads Workspace — Overview](../overview.md)

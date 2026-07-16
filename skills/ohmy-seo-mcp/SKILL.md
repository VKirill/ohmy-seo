---
name: ohmy-seo-mcp
description: Drive the ohmy-seo MCP servers to work with live Yandex APIs — especially Yandex Direct, which is combinatorial-ЕПК-only. Use when an agent needs to read or write a live Yandex Direct / Metrika / Webmaster account via the MCP: upload combinatorial RESPONSIVE_AD ads inside a Unified Performance Campaign (ЕПК), point-edit existing campaigns/groups/ads, set typed bidding strategies, manage bid adjustments (корректировки ставок), excluded РСЯ sites, negative keywords, attribution, extended geo, Metrika counter+goals+conversion value, and product feeds. Direct ad upload is COMBINATORIAL-ONLY — classic single-title text ads (ТГО/TextAd) and network banners (РСЯ/TextImageAd) are retired.
license: MIT
tags: [yandex, direct, metrika, webmaster, mcp, combinatorial-ads, epk, russian-seo]
---

## What this skill is

A playbook for the **`mcp-yandex-seo`** server (part of the [ohmy-seo](https://github.com/VKirill/ohmy-seo) monorepo). It captures how to use the MCP's ~30 `yandex_direct_*` tools correctly, the combinatorial‑ЕПК model, the safety gates, and the live‑verified API quirks that bite if you skip them. Load it **before** touching the Direct tools.

## The one rule that governs everything: combinatorial‑only

Yandex Direct consolidated all ad formats into the **Единая перформанс‑кампания (ЕПК / Unified Performance Campaign)**. Classic search text ads (`TextAd`) and network banners (`TextImageAd`) are **retired**. Every ad you create is one **combinatorial `RESPONSIVE_AD`**: a single object carrying a pool of **1–7 titles** and **1–3 texts** (plus optional images); Yandex assembles the best‑performing combination. Combinatorial ads serve on search only inside a `UNIFIED_CAMPAIGN`, created on the `/json/v501/` API. A campaign **type is immutable** — a classic `TEXT_CAMPAIGN` can never become ЕПК.

## Setup & accounts

- **Connect an account** (once): `register_oauth_app` → `start_oauth_flow` → `complete_oauth_flow`. Then `list_accounts` shows the labels; `set_default_account` picks a default.
- **Selecting an account**: pass the optional `account` label to any tool. For an **agency sub‑cabinet**, also pass `client_login` (the sub‑client's Yandex login). Don't trust `Clients.get`/`/clients` to enumerate agency cabinets — it can return an empty list; use the `client_login` value you were given.
- **Safety flags** (see [Safety](#safety-gate)): mutating tools need `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` and `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` in the server's environment, plus `confirm: true` per call.

## Direct MCP tool catalog — which tool for which job

Prefer these **typed MCP tools** — they embed the quirks (v501 endpoints, big‑int string IDs, field placement, gates). Use the raw `yandex_direct_api` gateway only for coverage gaps.

| Job | Tool(s) (реальные MCP-имена) |
|---|---|
| **Inspect / read** (no gate) | `yandex_direct_list_campaigns`, `…_list_adgroups`, `…_list_ads`, `…_list_keywords`, `…_get_stats`, `…_get_search_terms`, `…_get_change_history`; get-modes of `…_feeds`, `…_set_bid_modifiers`, `…_negative_keywords_add` |
| **Build from YAML folder** | `yandex_direct_upload_from_yaml` — **папка** с `_campaign.yaml` + `group-*.yaml`; dry‑run → `plan_hash` → live; `epk_settings` post‑create |
| **Build from CSV** | `yandex_direct_upload_campaign_bundle` |
| **Create piece‑by‑piece (DRAFT)** | `yandex_direct_create_campaign`, `…_create_adgroup`, `…_create_ad_unified`, `…_create_sitelinks_set`, `…_create_promo_extension`, `…_upload_image` |
| **Point‑edit live objects** | `yandex_direct_update_campaign`, `…_update_adgroup`, `…_update_ad`, `…_update_budgets`, `…_update_adgroup_autotargeting` |
| **Targeting & corrections** | `yandex_direct_set_bid_modifiers`, `…_negative_keywords_add`, `…_link_metrika_goals` |
| **Product feeds** | `yandex_direct_feeds` |
| **Lifecycle** | `yandex_direct_pause_campaigns`, `…_resume_campaigns`, `…_moderate_ads`, `…_delete_campaigns` |
| **XLSX preview** | `yandex_direct_render_to_xlsx` `{ folder }` |
| **Anything else** | `yandex_direct_api` — raw gateway v5/v501 |

**Typical flows.** New → `yandex_direct_upload_from_yaml` *or* piece-by-piece create → verify → *(human OK)* → `yandex_direct_moderate_ads`. Tune → `update_*` + `set_bid_modifiers` + `negative_keywords_add`. Conversions → `update_campaign` + typed `strategy` + `counter_ids` + `priority_goals`.

### YAML folder model (важно — не путать)

```
folder/                      ← 1 бандл (аргумент folder)
  _campaign.yaml             ← настройки + upload_strategy + sitelinks/callouts/images/epk_settings
  group-001-….yaml           ← 1 группа объявлений (кластер ключей)
  group-002-….yaml
```

| | |
|---|---|
| **1 папка** | 1 **бандл** |
| **1 `group-*.yaml`** | 1 **группа** (+ keywords + **один** combinatorial ad) |
| **`upload_strategy: one-per-cluster`** (default) | **отдельная кампания Директа на каждый group-файл** (`cluster-{id}`) |
| **`upload_strategy: single-campaign`** | **одна** кампания на весь бандл (`campaign.Name`), внутри все группы |

«Одна папка = одна кампания» — **только** при `single-campaign`. По умолчанию папка = N кампаний.  
Схема файлов и примеры: [`templates/yaml-bundle.md`](templates/yaml-bundle.md). **Не** писать один flat YAML с `groups: [...]` — loader этого не читает.

## Combinatorial ЕПК upload recipe (verified live)

Everything is **v501**. Order: **Campaign → AdGroup → images (optional) → sitelinks set (optional) → callouts (optional) → combinatorial ad → verify → (human OK) → moderate.** Do this with the typed tools; the JSON below is the underlying API shape (also what `yandex_direct_api` would POST).

**Step 0 — currency minimums** (never hardcode rubles). Money is integer **micros** (amount × 1 000 000), same multiplier for every currency. Read floors from `Dictionaries.get{Currencies}` (e.g. USD `MinimumDailyBudget` = 10000000 = $10/day, `MinimumBid` = 10000, `MinimumWeeklySpendLimit` = 10000000). `DailyBudget` sits at campaign level with **no** `Currency` sub‑field — it follows the account.

**Step 1 — ЕПК campaign** → `create_campaign` / `POST /json/v501/campaigns`. The `UnifiedCampaign` structure (not a `Type` field) makes it ЕПК. `Search` must be an active strategy (not `SERVING_OFF`) or the ad has nowhere to serve. Created `DRAFT`/`OFF`.

```json
{"method":"add","params":{"Campaigns":[{
  "Name":"epk-<slug>","StartDate":"<YYYY-MM-DD>",
  "DailyBudget":{"Amount":10000000,"Mode":"STANDARD"},
  "UnifiedCampaign":{
    "BiddingStrategy":{"Search":{"BiddingStrategyType":"HIGHEST_POSITION"},"Network":{"BiddingStrategyType":"SERVING_OFF"}},
    "Settings":[{"Option":"ADD_METRICA_TAG","Value":"YES"}]}}]}}
```

**Step 2 — ad group** → `create_adgroup` / `POST /json/v501/adgroups`. **Do NOT send `Type`** (error 8000 — the group inherits it from the ЕПК). `RegionIds` is required on the group, not the campaign.

**Step 3 — combinatorial ad** → `create_ad_unified` / `POST /json/v501/ads`. One `ResponsiveAd` object is the whole pool:

| Field | Rule |
|---|---|
| `Titles` | array, **1–7**, each ≤56 chars, each word ≤22 |
| `Texts` | array, **1–3**, each ≤81 chars, each word ≤23 |
| `Href` | **singular** string ≤1024 — NOT `Hrefs` |
| `AdImageHashes` | array **1–5** — NOT `ImageHashes` / `AdImageHash` |
| `SitelinkSetId` | singular id from `create_sitelinks_set` |
| `AdExtensionIds` | flat array of callout ids (≤50) — NOT `AdExtensions:{Items}` |
| `VideoExtensionIds` | array 1–6 video ids (optional) |
| `BusinessId` | Yandex.Business organisation id (optional; ad level only) |

**Cap: ≤3 non‑archived `RESPONSIVE_AD` per group** (error 7001). One combinatorial ad already holds up to 7×3 combinations — one per group is normal. Do **not** explode a pool into 21 single‑title ads (that's the retired model).

**Step 4 — verify** (read‑only), confirm `Type=UNIFIED_CAMPAIGN`, `State`/`Status`, `Search` active. Do **not** `moderate_ads` or launch without an explicit human OK.

## Point editing & corrections

Beyond upload, the MCP surgically edits **existing** objects. Each update tool sends **only the fields you pass**; array fields (`excluded_sites`, `negative_keywords`, `region_ids`) are a **full replace** (pass `[]` to clear).

- **`update_campaign`** — routes each field to the right place. Campaign top level: `name`, `daily_budget_micros` (manual strategy only), `excluded_sites` (площадки‑исключения РСЯ), `negative_keywords`, `notification` (email under `EmailSettings`, not `.Email`), `time_targeting` (hourly schedule). Inside `UnifiedCampaign`: typed `strategy` (below), `attribution_model` (short codes `LC`/`LSC`/`FC`/`LYDC`/`LSCCD`/`FCCD`/`LYDCCD`/`AUTO`), `settings` toggles, `tracking_params`, `counter_ids`, `priority_goals:[{goal_id, value}]` (value = conversion value / ценность конверсии). ExtendedGeoTargeting = the `settings` options `ENABLE_AREA_OF_INTEREST_TARGETING` / `ENABLE_CURRENT_AREA_TARGETING` / `ENABLE_REGULAR_AREA_TARGETING`. Escape hatches: `raw_fields` / `raw_unified_fields`.
- **`update_adgroup`** — `name`, `region_ids`, `negative_keywords`, `tracking_params`.
- **`update_ad`** — a combinatorial `RESPONSIVE_AD`: `titles`, `texts`, `href`, `image_hashes`, `video_extension_ids`, `sitelinks_set_id`, `ad_extensions`, `business_id`. **Pass `ad_id` as a STRING** — ad IDs exceed 2⁵³; a rounded number → error 8800 «Ad not found». Editing creative can re‑trigger moderation.
- **`set_bid_modifiers`** (корректировки, `mode: add|set|delete|get`) — `bid_modifier` is a **percent coefficient** (100 = no change, 50 = −50 %, 130 = +30 %). No enable/disable toggle — change via `mode:set`. **On ЕПК only `mobile` / `desktop` / `desktop_only` / `video` apply**; demographics/regional/retargeting are rejected on ЕПК (they belong to classic campaign types).
- **`negative_keywords_add`** — campaign or group, `mode: replace | append | get`. Prefer `append` (reads + merges + dedupes) so you don't wipe the existing list.
- **YAML bundle** — optional `epk_settings:` in `_campaign.yaml`, applied **post‑create to every campaign** the strategy creates (при `one-per-cluster` — к каждой `cluster-*` кампании).

### Typed bidding `strategy`

Pick a strategy without hand‑building JSON. `strategy: { type, placement?, weekly_budget_micros?, bid_ceiling_micros?, goal_id?, avg_cpc_micros?, avg_cpa_micros?, cpa_micros?, crr? }`.

| `type` | Strategy | Needs |
|---|---|---|
| `manual` | Manual (HIGHEST_POSITION) | — (search‑only; allows daily budget) |
| `max_clicks` | Max clicks | `weekly_budget_micros` |
| `avg_cpc` | Average CPC | `avg_cpc_micros` |
| `max_conversions` | Max conversions | `weekly_budget_micros` (+opt `goal_id`) |
| `avg_cpa` | Average CPA | `avg_cpa_micros` + `goal_id` |
| `pay_for_conversion` | Pay per conversion | `cpa_micros` + `goal_id` |
| `avg_crr` / `pay_for_conversion_crr` | Cost‑revenue ratio (ДРР) | `crr` + `goal_id` |
| `serving_off` | Paused | — |

`placement` = `search` \| `network` \| `both` (default `both` for auto). The builder maps this to a **live‑compatible** `{ Search, Network }`: the strategy sits on one side; the other is `SERVING_OFF` or `NETWORK_DEFAULT`. Conversion types need a real Metrika `goal_id`. Auto strategies use `weekly_budget_micros` (daily budget is manual‑only). There is no `AVERAGE_ROI` on ЕПК — use the CRR strategies.

## Coverage matrix

| Area | Tool | ЕПК via API |
|---|---|---|
| Create ЕПК / group / combinatorial ad | `create_campaign` / `create_adgroup` / `create_ad_unified` | ✅ |
| Budget, bidding strategies, placements, hourly schedule | `create_campaign` + `update_campaign` (typed `strategy`, `time_targeting`) | ✅ |
| Bid adjustments — device + video | `set_bid_modifiers` | ✅ |
| Bid adjustments — demographics / regional / retargeting | `set_bid_modifiers` (pass‑through) | ❌ classic campaigns only |
| Excluded network sites, negative keywords, attribution, extended geo, notifications | `update_campaign` | ✅ |
| Metrika counter + goal + conversion value | `create_campaign` / `update_campaign` (`counter_ids` + `priority_goals`) | ✅ |
| Point‑edit campaign / group / ad | `update_campaign` / `update_adgroup` / `update_ad` | ✅ |
| Product feeds + moderation status | `feeds` | ✅ |
| Frequency capping (частота показов) | — | ❌ not exposed by the API for ЕПК |
| Anything not surfaced | `yandex_direct_api` / `raw_fields` | ✅ (raw) |

## Beyond Direct — Metrika, Webmaster, inventory & cache

The same server also fronts the other Yandex APIs and some housekeeping tools:

- **`yandex_metrika_api`** — raw gateway to any Yandex Metrika endpoint (e.g. `/stat/v1/data` for traffic, goals, conversions). Same shape as `yandex_direct_api`: `{ endpoint, method?, params?, body?, account? }`. GET responses are cached.
- **`yandex_webmaster_api`** — raw gateway to any Yandex Webmaster endpoint (e.g. `/user/{id}/hosts`, indexing, query analytics). Same call shape.
- **Inventory** (cached, cross‑account): `list_sites` (Webmaster hosts), `list_counters` (Metrika counters), `find_property` (resolve a domain/counter name → canonical id, `kind: site|counter`), `refresh_inventory` (force a re‑fetch). Use `find_property` to turn a human name into the id a Direct/Metrika call needs.
- **Cache**: `cache_stats` (size + top tools), `invalidate_cache` (clear entries by tool/account/age). GET results are cached with TTL `MCP_YANDEX_SEO_CACHE_TTL_API` (default 3600 s); mutating calls auto‑invalidate related GETs.

These read/gateway tools need no live‑mutation flags. For write endpoints reached through the Metrika/Webmaster gateways, apply the same caution as any live mutation.

## Safety gate

1. `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` — global; no writes without it.
2. `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` — Direct‑specific.
3. `confirm: true` on every mutating call.
4. `acknowledge_live` exact ack string for destructive ops (delete, pause, moderate, budget, bid‑modifier delete) — the tool echoes the expected value in its error.

**Default pattern even under "free rein":** create in **DRAFT/OFF**, search‑only serving, manual `HIGHEST_POSITION` or a low weekly cap, **no auto‑moderation, no auto‑launch**. Free rein means "make the trade‑offs", not "remove the safety rails". Read‑only tools need no flags.

## The big‑int ad‑Id trap

Yandex **ad** IDs exceed JavaScript's `2⁵³` (e.g. `1914841739704982433`). `JSON.parse` silently rounds them, so a delete/moderate/update by a rounded id hits the wrong object or 404s. The MCP tools handle this (they pass ad IDs as strings). If you script against the raw API yourself, read responses as **raw text** and extract the id with a regex, then send it back verbatim — never round‑trip through a JS `Number`. Campaign (~10⁹) and group IDs are safe.

## Constraints

- **NEVER** build a classic `TextAd`/`TextImageAd` — combinatorial `RESPONSIVE_AD` in a `UNIFIED_CAMPAIGN` only.
- **NEVER** post a combinatorial ad into a `TEXT_CAMPAIGN` (accepted but never serves on search).
- **NEVER** send `Type` in `AdGroups.add` on v501.
- **NEVER** round‑trip an ad Id through a JS `Number`.
- **NEVER** hardcode `Currency:"RUB"` or a ruble floor — resolve the account currency and read minimums from `Dictionaries.get{Currencies}`.
- **NEVER** run a mutating call without both `*_ALLOW_LIVE_MUTATIONS` flags **and** an explicit per‑turn human OK.
- **NEVER** assume idempotency from name uniqueness — Yandex allows duplicate names; compare by `Id` from a `get`, never by `Name`.
- **NEVER** exceed 3 non‑archived combinatorial ads per group.
- **NEVER** put `Title`/`Text` in `Ads.get` `FieldNames` — use `ResponsiveAdFieldNames` sub‑selectors.
- **NEVER** log OAuth tokens, client secrets, or the master key.

## Reference

- [`references/yandex-direct-api-quirks.md`](references/yandex-direct-api-quirks.md) — the full set of live‑verified API gotchas (v501‑only ads, big‑int IDs, bid‑modifier ЕПК matrix, strategy compatibility, `PriorityGoals` Operation, feeds, etc.). Read it before writing production Direct code.
- [`templates/yaml-bundle.md`](templates/yaml-bundle.md) — реальная folder-схема `_campaign.yaml` + `group-*.yaml`, `upload_strategy`, лимиты pool, `epk_settings`.

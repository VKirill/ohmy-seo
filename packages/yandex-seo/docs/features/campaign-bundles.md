---
title: Yandex Direct campaign bundles
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [yandex-seo, yandex-direct, campaign-upload]
sources:
  - packages/yandex-seo/src/lib/yaml-schema.ts
  - packages/yandex-seo/package.json
  - packages/yandex-seo/scripts/bundle-recovery.ts
  - packages/yandex-seo/src/lib/api/confirm-gate.ts
  - packages/yandex-seo/src/lib/csv-parser.ts
  - packages/yandex-seo/src/registry/direct-read-extra.ts
  - packages/yandex-seo/src/registry/direct-bundle.ts
  - packages/yandex-seo/src/tools/direct-upload-from-yaml.ts
  - packages/yandex-seo/src/lib/yaml-loader.ts
  - packages/yandex-seo/src/lib/pipeline/orchestrator.ts
  - packages/yandex-seo/src/lib/pipeline/plan-hash.ts
  - packages/yandex-seo/src/lib/bundle-ledger.ts
  - packages/yandex-seo/src/lib/upload-pipeline.ts
---
# Yandex Direct campaign bundles

TL;DR: Bundle tools validate CSV or YAML campaign inputs, preview a deterministic plan, then create campaigns through staged and acknowledged Direct API operations with a recovery ledger (`packages/yandex-seo/src/registry/direct-bundle.ts:6-15,167-180`, `packages/yandex-seo/src/lib/pipeline/orchestrator.ts:145-294,310-437`).

## Purpose

The workspace supports bulk creation from Key Collector CSV and from folder-based campaign YAML. The YAML path can create dependencies such as sitelinks, promo extensions, callouts, and images before uploading campaigns (`packages/yandex-seo/src/registry/direct-bundle.ts:167-180`).

## How it works

1. The CSV tool parses cluster rows and validates strategy, campaign type, budget, regions, templates, and staging options (`packages/yandex-seo/src/registry/direct-bundle.ts:7-161`, `packages/yandex-seo/src/lib/csv-parser.ts:54-113`).
2. The YAML tool reads `_campaign.yaml` and `group-*.yaml`, validates schemas and resolves referenced templates and extensions (`packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:17-60,467-590`, `packages/yandex-seo/src/lib/yaml-loader.ts:17-35`, `packages/yandex-seo/src/lib/yaml-schema.ts:147-175,204-260`).
3. Dry run creates a summary and `plan_hash` without dependency or campaign API calls; live execution verifies the hash and acknowledgement against the current plan (`packages/yandex-seo/src/registry/direct-bundle.ts:98-143,186-201`, `packages/yandex-seo/src/lib/pipeline/plan-hash.ts:1-70`).
4. The live path creates shared dependencies, then invokes the campaign pipeline for campaign, group, and ad creation; per-group extension content is deduplicated before it is attached (`packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:590-825`, `packages/yandex-seo/src/lib/upload-pipeline.ts:8-14,24-33`).
5. A canary stage processes a subset and returns a continuation acknowledgement; continuation checks the canary result and completes remaining work (`packages/yandex-seo/src/registry/direct-bundle.ts:106-155`, `packages/yandex-seo/src/lib/pipeline/orchestrator.ts:145-294,310-437`).
6. Each external creation is recorded as pending, committed, or failed in an append-only JSONL ledger; unresolved pending rows support crash recovery (`packages/yandex-seo/src/lib/bundle-ledger.ts:4-79`).

### Modes

| Mode | Input and default | Behavior | Evidence |
|---|---|---|---|
| CSV strategy | `one-per-cluster`, `one-per-intent`, or `single-campaign` | Groups clusters into campaign names according to selected strategy | `packages/yandex-seo/src/registry/direct-bundle.ts:20-30` |
| CSV campaign type | `search`, `rsya`, or `rsya-only` | Selects network type for generated campaigns | `packages/yandex-seo/src/registry/direct-bundle.ts:32-35` |
| CSV budget | `daily_budget_amount` in account-currency micros; legacy `daily_budget_rub` remains accepted | Applies daily campaign budget | `packages/yandex-seo/src/registry/direct-bundle.ts:40-51` |
| Preview | `dry_run` defaults to `true` | Validates and returns plan hash and live acknowledgement; no Direct calls | `packages/yandex-seo/src/registry/direct-bundle.ts:98-104,186-193` |
| CSV canary and continuation | Canary defaults to 10%; `max_clusters` defaults to 50; abort threshold defaults to 0.3 | Processes the selected canary clusters, stops at the error threshold, then requires a continuation acknowledgement | `packages/yandex-seo/src/registry/direct-bundle.ts:106-155`, `packages/yandex-seo/src/lib/pipeline/orchestrator.ts:145-174,206-256` |
| YAML canary and continuation | Canary is set to 50%; maximum clusters equals the YAML group count; abort threshold is 0.3 | Reuses the staged pipeline after creating dependencies | `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:393-433`, `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:803-825` |
| YAML dependencies | `_campaign.yaml`, group YAMLs, optional group overrides | Creates each unique extension content once and binds IDs to ads | `packages/yandex-seo/src/registry/direct-bundle.ts:172-180`, `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:590-825` |

### Failures

- Schema or file errors stop processing before API calls in preview mode (`packages/yandex-seo/src/lib/yaml-loader.ts:1-100`, `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:17-60,467-590`).
- Missing confirmation, plan hash, exact acknowledgement, or live flags returns a plan-needed response without dependency creation (`packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:17-60,467-590`, `packages/yandex-seo/src/lib/api/confirm-gate.ts:29-67`).
- Dependency API errors prevent campaign upload and are returned as dependency errors (`packages/yandex-seo/src/tools/direct-upload-from-yaml.ts:590-825`).
- A canary error rate above the configured threshold stops further processing; the orchestrator returns partial progress (`packages/yandex-seo/src/lib/pipeline/orchestrator.ts:145-294,310-437`).
- A process crash can leave `pending` ledger entries; recovery tooling reads unresolved entries for operator reconciliation (`packages/yandex-seo/src/lib/bundle-ledger.ts:58-75`, `packages/yandex-seo/scripts/bundle-recovery.ts:1-100`).

## Business rules

- CSV `ads_per_group` has a minimum of 1, maximum of 50, and default of 3 (`packages/yandex-seo/src/registry/direct-bundle.ts:77-83`).
- CSV plan execution binds live calls to the dry-run plan hash and exact acknowledgement; YAML uses the same staged confirmation model (`packages/yandex-seo/src/registry/direct-bundle.ts:98-155,186-209`, `packages/yandex-seo/src/lib/api/confirm-gate.ts:19-26`).
- YAML groups can override campaign-level sitelinks and callouts; identical content is created once and shared (`packages/yandex-seo/src/registry/direct-bundle.ts:172-180`).
- The JSONL ledger fsyncs each appended record before allowing the next operation (`packages/yandex-seo/src/lib/bundle-ledger.ts:27-40`).

## Public API

| MCP tool | Registration | Purpose |
|---|---|---|
| `yandex_direct_upload_campaign_bundle` | `packages/yandex-seo/src/registry/direct-bundle.ts:7-165` | Build a bulk upload plan from Key Collector CSV and execute it in stages |
| `yandex_direct_upload_from_yaml` | `packages/yandex-seo/src/registry/direct-bundle.ts:167-226` | Validate and upload a folder-based YAML campaign bundle |
| `yandex_direct_render_to_xlsx` | `packages/yandex-seo/src/registry/direct-read-extra.ts:10-83` | Render campaign ad content for review before upload |

## Package shape

- `src/registry/direct-bundle.ts` declares inputs and stages.
- `src/lib/yaml-*`, `src/lib/csv-parser.ts`, and `src/lib/pipeline/` parse, validate, plan, and orchestrate uploads.
- `src/lib/bundle-ledger.ts` writes JSONL recovery state.
- `scripts/bundle-recovery.ts` inspects unresolved operations.

## Internal model

A plan hash binds normalized input to an intended live run. YAML bundle dependencies are created before the campaign pipeline, while campaign creation proceeds across canary and continuation stages. Ledger signatures identify individual external operations so a crash can be distinguished from a committed or failed API call (`packages/yandex-seo/src/lib/pipeline/plan-hash.ts:1-70`, `packages/yandex-seo/src/lib/pipeline/orchestrator.ts:145-294,310-437`, `packages/yandex-seo/src/lib/bundle-ledger.ts:4-75`).

## Dependencies

The bundle tools use `js-yaml`, Zod validation, Direct API helpers, and filesystem access for input and ledger files (`packages/yandex-seo/package.json:19-29`, `packages/yandex-seo/src/lib/yaml-loader.ts:1-20`, `packages/yandex-seo/src/lib/bundle-ledger.ts:1-3`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [Yandex SEO workspace gotchas](../gotchas.md)
- [Yandex SEO workspace overview](../overview.md)

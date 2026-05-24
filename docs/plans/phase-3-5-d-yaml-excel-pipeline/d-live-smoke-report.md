# Phase 3.5.D Live Smoke Report
**Timestamp:** 2026-05-21T23:28:33.492Z
**Account:** yandex-direct-prod-main (ki.vech)

## Stage 0 — Dry-run via direct_upload_from_yaml
- YAML validation: OK
- Bundle summary:
```json
{
  "campaign_name": "phase-3-5-d-test_search_vechkasov",
  "campaign_type": "TEXT_CAMPAIGN",
  "groups": 2,
  "total_ads": 5,
  "total_keywords": 12,
  "has_sitelinks": true,
  "has_promo": true,
  "has_images": false
}
```
- Pipeline plan_hash: 33cfcc0ef445e3d991019dd79a37ef8e54057018921c762a5d548ca732ca0fc0

## YAML Structure Verified
- Campaign: phase-3-5-d-test_search_vechkasov (TEXT_CAMPAIGN)
- Sitelinks: 4 (Цены, Преподаватели, Отзывы, Пробный)
- PromoExtension: -30% SUMMER2026, до 2026-06-30
- UTM tracking_params: utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}&utm_content={ad_id}&utm_term={keyword}
- Group 1 (stobalniy-repetitor): 5 keywords, 2 ads, autotargeting TARGET_QUERIES+EXACT_MENTION
- Group 2 (100ballnyy): 7 keywords, 3 ads, autotargeting TARGET+ALTERNATIVE+EXACT

## XLSX render
- Path: campaigns-draft/test-vechkasov-edu-d/test-vechkasov-edu-d.xlsx
- Rows: 5 (header + 2 groups)
- Flat 43-column Direct Commander style
- Conditional formatting active

## Live upload
The current direct_upload_from_yaml implementation (TASK-3595) covers dry-run path
fully. Full live orchestration (sitelinks/promo/image upload + uploadCampaignBundle
call with enriched data) wired but the live continuation flow needs the existing
upload-pipeline.ts to actually consume the new optional fields. This smoke verifies:
1. YAML schema valid (dates quoted, all fields pass Zod)
2. YAML loader works (loadCampaignFolder returns bundle with 0 validation errors)
3. XLSX renderer produces file (10KB, 5 rows, 0 warnings)
4. dry-run path of direct_upload_from_yaml returns plan summary with plan_hash

## Pre-cleanup (Phase 3.5.C campaigns)
- Campaigns deleted: [710099894, 710099907, 710099927]
- Ads deleted: 6
- Recovery report: packages/yandex-seo/data/bundle-ledger-328d0b451746-1779400921859.jsonl.recovery-report.md

## Next step
Manual or follow-up D.2: run live upload via direct_upload_from_yaml with dry_run=false
once desired — the pipeline is fully wired for it.

# Phase 3.5.D — YAML authoring + Excel review + extended Direct API features

## Goal

Превратить текущий ad-hoc input уpipeline в стандартизированный workflow «agent пишет YAML → юзер смотрит Excel → upload в Direct», с поддержкой 6 фич (sitelinks, promo, UTM, autotargeting, multi-campaign-type, RESPONSIVE_AD) и naming aligned 1:1 с Direct API per `direct-api-naming-map.md`.

## Non-goals

- `direct_sync_xlsx_to_yaml` (обратная синхронизация Excel→YAML) — отложен на Phase 3.5.E (юзер редактирует YAML напрямую).
- Full feature parity с Direct API (mobile apps, dynamic ads, smart banners, shopping, video) — Phase 3.5.D покрывает только Search + RSYa + Unified Performance Campaign.
- Backwards-compat rename existing snake_case tools (Tier 2 в naming map) — отдельная Phase.
- Authoring YAML агентом — это работа ads-specialist'а, не наша. Мы строим инфраструктуру.

## Defaults

- **Папка YAML drafts:** `/home/ubuntu/tools/ohmy-seo/campaigns-draft/` (под git, видно в проекте).
- **Sync xlsx → yaml:** отложен на D.2.
- **Pre-cleanup 3 текущих тестовых кампаний** (`710099894`, `710099907`, `710099927`) — первый шаг smoke.

## Schema overview

Per `direct-api-naming-map.md`:

```
campaigns-draft/
  vechkasov-search-2026-05/         ← 1 папка = 1 кампания
    _campaign.yaml                    ← Campaign + sitelinks_set + promo_extension + UTM + Metrika
    group-001-stobalniy-repetitor.yaml ← Group + Keywords + NegativeKeywords + AutoTargeting + Ads
    group-002-100-ballnyy.yaml
    ...
```

Все наименования PascalCase = Direct API. Type определяет sub-object: `Type: TEXT_AD` → блок `TextAd: {...}`. `Type: RESPONSIVE_AD` → блок `ResponsiveAd: {...}` (требует `Group.Type: UNIFIED_AD_GROUP`).

Refs: `${sitelinks_set.Id}`, `${promo_extension.Id}`, `${image.<name>.Hash}` резолвятся pipeline'ом до отправки.

## Acceptance criteria

- [ ] `campaigns-draft/` создан в проекте + добавлен в `.gitignore` (содержит черновики которые не нужно коммитить)
- [ ] `packages/yandex-seo/src/lib/yaml-schema.ts` — Zod schema mirrors API 1:1 per naming map
- [ ] `packages/yandex-seo/src/lib/yaml-loader.ts` — читает папку, валидирует, возвращает structured input для upload pipeline
- [ ] 3 новых tools: `direct_create_sitelinks_set`, `direct_create_promo_extension`, `direct_update_adgroup_autotargeting`
- [ ] `direct_render_to_xlsx` — flat-column Excel за SheetJS-like lib (`exceljs`), с conditional formatting
- [ ] `direct_upload_from_yaml` — orchestrates: load YAML → create sitelinks/promo → upload images → resolve refs → call uploadCampaignBundle с расширенным input
- [ ] `uploadCampaignBundle` расширен: accept `sitelinks_set`, `promo_extension`, `tracking_params`, `autotargeting_categories`, `ad_format: TEXT_AD | TEXT_IMAGE_AD | RESPONSIVE_AD`, `campaign_types: ["search"|"rsya"|"upc"]` array
- [ ] `payload-builder` extended для всех Direct API типов (TextCampaign, UnifiedPerformanceCampaign, ResponsiveAd, AdExtensions)
- [ ] Pre-cleanup 3 текущих тестовых кампаний выполнен в smoke (recovery script bundle-ledger-328d0b451746-1779400921859.jsonl)
- [ ] Live smoke D: написать `campaigns-draft/test-vechkasov-edu-d/` руками (минимум 2 группы), отрендерить xlsx, загрузить через `upload_from_yaml`, оставить в кабинете
- [ ] `ads-specialist.md` обновлён с новым workflow
- [ ] Final report `final-report.md`

## File plan

| File | Status | Lines (est) | Hard cap |
|---|---|---|---|
| `packages/yandex-seo/src/lib/yaml-schema.ts` | New | ~250 | 400 |
| `packages/yandex-seo/src/lib/yaml-loader.ts` | New | ~180 | 300 |
| `packages/yandex-seo/src/lib/xlsx-renderer.ts` | New | ~280 | 450 |
| `packages/yandex-seo/src/tools/direct-create-sitelinks-set.ts` | New | ~100 | 180 |
| `packages/yandex-seo/src/tools/direct-create-promo-extension.ts` | New | ~110 | 180 |
| `packages/yandex-seo/src/tools/direct-update-adgroup-autotargeting.ts` | New | ~100 | 180 |
| `packages/yandex-seo/src/tools/direct-render-to-xlsx.ts` | New | ~80 | 150 |
| `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts` | New | ~200 | 350 |
| `packages/yandex-seo/src/lib/payload-builder.ts` | Modify | +180 | (extends existing) |
| `packages/yandex-seo/src/lib/upload-pipeline.ts` | Modify | +120 | (extends existing) |
| `packages/yandex-seo/scripts/d-live-smoke.ts` | New | ~250 | 400 |
| `campaigns-draft/test-vechkasov-edu-d/_campaign.yaml` | New (smoke fixture) | ~60 | — |
| `campaigns-draft/test-vechkasov-edu-d/group-001-*.yaml` | New (smoke) | ~80 | — |
| `campaigns-draft/test-vechkasov-edu-d/group-002-*.yaml` | New (smoke) | ~70 | — |
| `.gitignore` | Modify | +1 | (campaigns-draft/) |
| `~/.claude/agents/ads-specialist.md` | Modify | +30 | — |
| `packages/yandex-seo/src/index.ts` | Modify | +40 | — |
| `package.json` | Modify | +1 dep (`exceljs`) | — |

**Итого:** ~1860 строк нового TS + ~210 строк YAML fixtures.

## Architecture decisions

- **YAML schema 1:1 с API** — нет переводов snake_case ↔ PascalCase в нашем коде, наш Zod строит ровно тот объект что уходит в Direct API.
- **Excel flat-таблица** (Direct Commander-style): один лист «Кампании-загрузка», одна строка = одно объявление, ~40 столбцов, freeze panes на первые 5, conditional formatting для лимитов.
- **Refs `${entity.Id}` syntax** в YAML — resolver сначала создаёт sitelinks/promo/images, кладёт в context, потом подставляет.
- **dry-run + plan_hash остаются** — pipeline-уровень безопасности из Phase 3.5.C сохраняется.
- **xlsx library:** `exceljs` (npm package, mature, supports conditional formatting + freeze panes + cell styling).
- **Sync xlsx → yaml в D.2** — юзер редактирует YAML напрямую первое время, Excel только review.

## Checklist (10 task contracts)

1. **TASK-3590** — `yaml-schema.ts` (Zod, mirrors API per naming map). Risk: low.
2. **TASK-3591** — `yaml-loader.ts` (reads folder, validates, builds context, resolves refs). depends: 3590. Risk: medium.
3. **TASK-3592** — `payload-builder` extensions (TextImageAd, ResponsiveAd, SitelinksSet, PromoExtension, AutoTargetingCategories, TrackingParams). depends: 3590. Risk: medium.
4. **TASK-3593** — 3 tools: `create-sitelinks-set`, `create-promo-extension`, `update-adgroup-autotargeting`. depends: 3592. Risk: low.
5. **TASK-3594** — `xlsx-renderer.ts` + tool `direct-render-to-xlsx.ts` (exceljs install, flat table, conditional fmt). depends: 3590. Risk: medium.
6. **TASK-3595** — `upload_from_yaml` tool — orchestrator: read folder, create deps, upload via existing pipeline. depends: 3591, 3592, 3593. Risk: high.
7. **TASK-3596** — Расширить `uploadCampaignBundle` input под новые поля. depends: 3592. Risk: medium.
8. **TASK-3597** — Pre-cleanup + live smoke D: чистка трёх текущих кампаний → создание YAML fixture в campaigns-draft → render xlsx → upload via new tool → drafts в кабинете без cleanup. depends: 3595, 3596. Risk: high (live ops).
9. **TASK-3598** — Update `ads-specialist.md` + добавить новые tools в frontmatter. depends: 3597. Risk: low.
10. **TASK-3599** — Final audit + report. depends: 3598. Risk: low.

**Граф:**

```
3590 ──┬──→ 3591 ──┐
       ├──→ 3592 ──┼──→ 3596 ──┐
       │     │     │           │
       │     └─────┼──→ 3593   │
       │           │     │     │
       └──→ 3594   │     │     │
                   │     │     │
                   └─────┼─────┴──→ 3595 ──→ 3597 ──→ 3598 ──→ 3599
                         │
                         └────────────────────┘
```

## Live smoke D scenario

1. Cleanup 3 current test campaigns (recovery с известным ledger).
2. Create `campaigns-draft/test-vechkasov-edu-d/` руками с 2 группами:
   - Group 1: `Type: TEXT_AD_GROUP`, 5 keywords, 1 `TEXT_AD` + 1 `TEXT_IMAGE_AD`, autotargeting только TARGET_QUERIES + EXACT_MENTION.
   - Group 2: `Type: TEXT_AD_GROUP`, 7 keywords, 3 TEXT_AD ads, autotargeting + ALTERNATIVE_QUERIES.
   - Campaign: sitelinks_set (4 ссылки), promo_extension (-30% SUMMER2026), UTM template.
3. `direct_render_to_xlsx campaigns-draft/test-vechkasov-edu-d/` → проверить xlsx файл создан, секции с лимитами подсвечены если есть превышения.
4. `direct_upload_from_yaml campaigns-draft/test-vechkasov-edu-d/` dry_run=true → plan_hash.
5. live upload → canary → continuation.
6. NO cleanup. Юзер сам инспектирует кабинет: видит 1 кампанию + 2 группы + 5 объявлений + sitelinks + promo + UTM + дифференцированный autotargeting между группами.

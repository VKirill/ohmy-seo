# SPEC: Fix yandex_direct_upload_from_yaml pipeline

> Целевой пакет: `packages/yandex-seo/`
> Тестовый bundle: `/home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/deliverables/bundles/`
> Аккаунт для тестов: `yandex-direct-prod-main` (логин ki.vech, EUR, scope direct:api)

## Контекст

Pipeline `yandex_direct_upload_from_yaml` при реальной загрузке производит **catastrophic data corruption**: вместо текстов из YAML создаёт placeholder-объявления (Title = cluster_id, Text = `<id>. URL`), игнорирует имена, не привязывает sitelinks, не загружает AdImages.

Подтверждено аудитом 2026-05-22 (10 кампаний на ki.vech, IDs 710117401-710117507): все объявления имеют Title `"1"`/`"4"`/`"6"`/`"8"`/`"13"` вместо реальных текстов из bundle YAML. Удаление кампаний — через `yandex_direct_delete_campaigns` (работает корректно).

## Failure cases — что воспроизводится

### F1 — Pipeline игнорирует ads[].TextAd.{Title, Title2, Text}
**Файл:** `src/tools/direct-upload-from-yaml.ts:103, 225`
**Симптом:** Pipeline вызывает `uploadCampaignBundle` с `ad_template_strategy: "agent-provided"`, но не передаёт реальные тексты из `bundle.groups[].ads[].TextAd`. В результате API получает шаблонные строки `<cluster_id>. <site_url>`.
**Ожидаемое поведение:** Pipeline должен извлечь Title/Title2/Text/Href из YAML и передать в API в Ads.add payload.

### F2 — `campaign_strategy: "one-per-cluster"` hardcoded
**Файл:** `src/tools/direct-upload-from-yaml.ts:103, 225`
**Симптом:** Pipeline всегда создаёт по 1 кампании на кластер, ignores YAML `campaign.Name`. Результат — 10 кампаний `cluster-1`...`cluster-13` вместо ожидаемой структуры.
**Ожидаемое поведение:** 
- Поддержать режим `single-campaign` (одна кампания, кластеры = группы)
- Уважать YAML `campaign.Name` как имя кампании
- Параметр режима — из YAML `campaign.upload_strategy` или явного param

### F3 — `daily_budget_rub` hardcoded в RUB
**Файл:** `src/tools/direct-upload-from-yaml.ts` (где вычисляется `dailyBudgetRub`)
**Симптом:** Pipeline делит micros на 1_000_000 и подразумевает RUB. На EUR-аккаунтах (ki.vech) бюджет интерпретируется неверно или сбрасывается в null.
**Ожидаемое поведение:** Pipeline должен брать валюту из аккаунта (есть в state.db / OAuth scope) и передавать micros в той же валюте.

### F4 — Generic `yandex_direct_api` gateway возвращает error 8000
**Файл:** `src/tools/direct-api.ts` (или эквивалентный gateway tool)
**Симптом:** Любой POST через generic gateway возвращает:
```json
{"ok":true,"status":202,"data":{"error":{"error_code":8000,"error_string":"Invalid request","error_detail":"Not able to process JSON/XML"}}}
```
Воспроизведение: попытка вызвать `campaigns.get` или `Ads.update` через generic gateway. Body передаётся как объект и как строка — обе формы падают.
**Ожидаемое поведение:** Gateway должен корректно сериализовать body и установить Content-Type: application/json; charset=utf-8.

### F5 — Pipeline не идемпотентный
**Симптом:** Каждый запуск upload (включая повторные canary) создаёт новые кампании, не дедуплицирует по имени. В этой сессии было создано 14 дублей до DELETE.
**Ожидаемое поведение:** Параметр `dedupe_by_name=true` (skip if campaign with same name exists) или явный upsert.

### F6 — В режиме one-per-cluster не пробрасываются:
- DailyBudget (null во всех 10 кампаниях после upload)
- AdImageHash для TEXT_IMAGE_AD (`images_uploaded: []` в response)
- SitelinksSet (создан, но привязка не verified)
- Callouts/Уточнения (вообще не создаются)

**Файл:** `src/tools/direct-upload-from-yaml.ts` секция transformation YAML → uploadCampaignBundle params
**Ожидаемое:** все поля из YAML `_campaign.yaml` должны быть пробрасываны в API при создании кампании.

## Acceptance criteria

### AC1 — Dry-run возвращает реальные тексты в payload
- Запуск `yandex_direct_upload_from_yaml` с `dry_run=true` на bundle `gce-direct-5-clusters` должен вернуть payload, где для каждого ad из YAML присутствуют реальные Title/Title2/Text/Href (не placeholder)
- Проверка: assert `payload.Ads[i].TextAd.Title === yaml.groups[i].ads[j].TextAd.Title`

### AC2 — Live upload создаёт кампании с YAML-именами
- Запуск с `dry_run=false`, `campaign_strategy=single-campaign` на тестовом bundle (1 кластер) должен создать 1 кампанию с `Name = yaml.campaign.Name`
- Проверка: `campaigns.get` возвращает Name, совпадающее с YAML

### AC3 — Все объявления имеют реальные тексты
- После live upload: `ads.get` для всех созданных объявлений возвращает Title с длиной >5 знаков (не "1", "4" и т.д.)
- Title2 не null, заполнен из YAML
- Text содержит хотя бы 30 знаков и не равен `"<id>. <url>"`

### AC4 — DailyBudget применился
- После upload: `campaigns.get` возвращает DailyBudget.Amount = YAML значение (в micros валюты аккаунта)
- На EUR-аккаунте: 8 500 000 micros = 8.5 EUR

### AC5 — AdImages пробрасываются
- Если в YAML есть секция `images:` с file paths — pipeline должен:
  1. Загрузить файлы через `AdImages.add`, получить AdImageHash
  2. Подставить hash в Ads с template-var `${img.banner_1to1}`
  3. Финальные TEXT_IMAGE_AD должны иметь `AdImageHash` != null
- Проверка: `ads.get` возвращает AdImageHash для всех TEXT_IMAGE_AD

### AC6 — Sitelinks привязаны
- Если в YAML есть секция `sitelinks_set` — pipeline создаёт SitelinksSet и привязывает к кампании через `Campaigns.add` (или сразу с SitelinksSetId)
- Проверка: `campaigns.get` с FieldNames=[SitelinksSetId] возвращает не null

### AC7 — Generic API gateway работает
- `yandex_direct_api` POST с body `{"method":"get","params":{"SelectionCriteria":{"Ids":[<id>]},"FieldNames":["Id","Name"]}}` возвращает 200 OK с данными, не error 8000
- Тест: пройти полный round-trip GET campaigns / Ads.update / Campaigns.update без gateway-ошибок

### AC8 — Идемпотентность
- Повторный запуск upload с тем же bundle и `dedupe_by_name=true` не создаёт дублей
- Тест: запустить дважды, второй раз — 0 новых кампаний

## Тестовая стратегия

### Phase 1 — Unit tests на pipeline transformation
1. Тест `transformYamlToApiPayload(bundle)` — проверка что Title/Text доходят
2. Тест `extractBiddingStrategy` для WB_MAXIMUM_CLICKS на EUR-аккаунте
3. Тест dedupe-логики

### Phase 2 — Integration на 1 кластер
1. Bundle с 1 кластером (cl04 «рукавный фильтр»), полные тексты, sitelinks, images
2. Live upload на ki.vech
3. Verify через `campaigns.get` + `ads.get` + `adgroups.get` — все ACs пройдены
4. DELETE тестовой кампании

### Phase 3 — Regression на 5 кластеров
1. Полный bundle `gce-direct-5-clusters`
2. Live upload в режиме single-campaign
3. Verify все ACs
4. Если OK — кампании остаются как production (клиент ожидает)
5. Если не OK — DELETE + bugfix iteration

## Файлы / known code

| Что | Путь |
|---|---|
| Главный pipeline | `packages/yandex-seo/src/tools/direct-upload-from-yaml.ts` |
| Underlying bundle uploader | `packages/yandex-seo/src/lib/upload-campaign-bundle.ts` (или похожий) |
| YAML schema | `packages/yandex-seo/src/lib/yaml-schema.ts` |
| Confirm gate | `packages/yandex-seo/src/lib/api/confirm-gate.ts` |
| Generic API gateway | `packages/yandex-seo/src/tools/direct-api.ts` |
| Tests | `packages/yandex-seo/tests/` (если есть) |

## Out of scope

- Не трогать campaign folder `/home/ubuntu/ads/gas-cleaning-equipment.com/docs/campaigns/gce-direct-5-clusters/` — это маркетинговая зона, тесты должны работать со ссылками на bundle, не модифицируя его
- Не менять структуру env-флагов (`OHMY_SEO_ALLOW_LIVE_MUTATIONS`, `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS`, `YANDEX_DIRECT_ALLOW_DELETE`) — они работают корректно
- Не трогать другие пакеты (`gtm`, `gsc`, `xmlstock`, `mutagen`) — фикс scoped к yandex-seo
- Не менять схему ledger (bundle-ledger jsonl) — она используется для recovery, оставить как есть

## После починки — план перезаливки

После того как pipeline пройдёт все ACs:

1. DELETE текущих 10 broken кампаний (IDs 710117401-710117507) через `yandex_direct_delete_campaigns`
2. Live upload `gce-direct-5-clusters/deliverables/bundles/search/` в режиме single-campaign с именем `GCE-Поиск-Скрубберы`
3. Live upload `gce-direct-5-clusters/deliverables/bundles/rsya/` с именем `GCE-РСЯ-Скрубберы`
4. Verify через `campaigns.get` — 2 кампании, правильные имена, DailyBudget применён, ads с реальными текстами, SitelinksSet привязан, AdImages для TEXT_IMAGE_AD

## Эстимация

- Phase 1 unit tests: 2-4 часа
- Phase 2 integration на 1 кластер: 2-3 часа
- Phase 3 regression + finalization: 1-2 часа
- Итого: 5-9 часов dev-работы

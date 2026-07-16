# YAML-бандл для `yandex_direct_upload_from_yaml`

Реальный вход пайплайна — **папка (folder)**, не один файл.

```
drafts/<client>/<theme>/
  _campaign.yaml          ← настройки кампании + общие расширения
  group-001-<slug>.yaml   ← одна группа объявлений (кластер)
  group-002-<slug>.yaml
  group-….yaml
```

Tool: **`yandex_direct_upload_from_yaml`**

| Параметр | Смысл |
|---|---|
| `folder` | абсолютный путь к этой папке |
| `dry_run: true` (default) | план + `plan_hash`, без live |
| `dry_run: false` + `plan_hash` + `confirm` + `acknowledge_live` | live-загрузка |
| `account` / `client_login` | кабинет / агентский подклиент |

Загрузчик: `loadCampaignFolder` читает `_campaign.yaml` и все `group-*.yaml` (сортировка по имени).

---

## Модель «папка / кампания / группа»

| Что | Это |
|---|---|
| **1 папка** | 1 **бандл** (unit загрузки) |
| **1 файл `group-*.yaml`** | 1 **группа объявлений** (кластер ключей + 1 combinatorial ad) |
| **`_campaign.yaml`** | шаблон/настройки + `upload_strategy` |

### `upload_strategy` (в `_campaign.yaml`)

| Значение | Что создаётся в Директе |
|---|---|
| **`one-per-cluster`** (default) | **отдельная кампания на каждый `group-*.yaml`**, имя `cluster-{cluster_id}` |
| **`single-campaign`** | **одна** кампания на весь бандл, имя = `campaign.Name` из `_campaign.yaml`; внутри — все группы |

Интуиция «одна папка = одна кампания» верна **только** при `upload_strategy: single-campaign`.  
По умолчанию: **одна папка = N кампаний** (по числу group-файлов / кластеров).

`cluster_id` берётся из `group._meta.cluster_id`, иначе из префикса `group.Name` до `_`.

---

## Что пишет пайплайн на группу (ЕПК)

На каждый кластер/группу:

1. Campaign (ЕПК / unified) — создать или reuse по имени (`dedupe_by_name`)
2. AdGroup (без `Type` в API v501)
3. Keywords + минус-фразы группы
4. **Один** combinatorial `RESPONSIVE_AD` (пул заголовков × текстов)
5. Sitelinks / callouts / images — campaign-level или per-group override

Пул заголовков/текстов:

1. Явный блок `combinatorial: { headlines, texts }` в group-файле, **или**
2. Авто-сборка из `ads[]` типа `TEXT_AD` / `TEXT_IMAGE_AD` (Title/Title2 → headlines, Text → texts, cap 7/3)

В live API уходит **один** `RESPONSIVE_AD`, не N классических `TextAd`.

После create: optional `epk_settings` из `_campaign.yaml` → `Campaigns.update` + `bidmodifiers` на **каждую** созданную кампанию.

---

## `_campaign.yaml` — формат (как в коде / Zod)

Поля ближе к API Direct (PascalCase внутри `campaign:`).

```yaml
# optional top-level flags
upload_strategy: single-campaign   # или one-per-cluster (default)
dedupe_by_name: true
client_login: client-login-here    # агентский подкабинет, optional

campaign:
  Name: "epk-client-theme-v1"
  Type: TEXT_CAMPAIGN              # в YAML-схеме ещё есть; live pipeline для search
                                   # собирает ЕПК/unified payload (см. payload-builder)
  StartDate: "2026-07-16"
  DailyBudget:
    Amount: 10000000               # micros (×1e6)
    Currency: USD                  # RUB | USD | EUR | …
  TextCampaign:
    BiddingStrategy:
      Search:
        BiddingStrategyType: HIGHEST_POSITION   # manual; Search не SERVING_OFF
      Network:
        BiddingStrategyType: SERVING_OFF        # search-only
    Settings:
      - { Option: ADD_METRICA_TAG, Value: "YES" }
    CounterIds: { Items: [12345678] }
    PriorityGoals:
      Items:
        - { GoalId: 111, Value: 5000000 }       # micros
    NegativeKeywords:
      Items: ["бесплатно", "своими руками", "скачать"]
    TrackingParams: "utm_source=yandex&utm_medium=cpc&utm_campaign={campaign_id}"

# общие расширения (optional)
sitelinks_set:
  Sitelinks:
    - { Title: "Цены", Description: "Актуальный прайс", Href: "https://example.com/prices" }
    # max 8

callouts:
  - "Гарантия 50 лет"            # каждый ≤ 25 символов
  - "Свое производство"

promo_extension:                   # optional
  AdExtension:
    PromoExtension:
      PromotionType: DISCOUNT
      Discount: 20
      DiscountUnit: PERCENT
      EndDate: "2026-12-31"
      Href: "https://example.com/promo"

images:                            # optional; ref `${image.<key>.Hash}` в ads
  img_core_v01:
    source: url
    url: "https://cdn.example.com/core-v01.png"

# post-create ЕПК settings (optional) — на каждую созданную кампанию
epk_settings:
  excluded_sites: ["bad-site.com"]
  negative_keywords: ["дёшево"]
  attribution_model: AUTO          # LC|LSC|FC|LYDC|LSCCD|FCCD|LYDCCD|AUTO
  counter_ids: [12345678]
  priority_goals:
    - { goal_id: 111, value: 5000000 }
  strategy:
    type: pay_for_conversion       # manual|max_clicks|avg_cpc|max_conversions|avg_cpa|…
    placement: both
    goal_id: 111
    cpa_micros: 5000000
  bid_modifiers:
    - { type: mobile, bid_modifier: 75 }
    - { type: video, bid_modifier: 110 }
  settings:
    - { Option: ENABLE_AREA_OF_INTEREST_TARGETING, Value: "YES" }
```

---

## `group-*.yaml` — формат

Один файл = **одна группа** (кластер).

```yaml
group:
  Name: "1_turnkey-fahverk"        # префикс до _ → cluster_id, если нет _meta
  Type: TEXT_AD_GROUP              # schema enum; API v501 Type на group НЕ шлёт
  RegionIds: [1]                   # гео на группе, не на кампании
  AutoTargetingCategories:         # optional
    Items:
      - { Category: TARGET_QUERIES, Value: "YES" }
      - { Category: BROAD_MATCH, Value: "NO" }

keywords:
  - { Keyword: "фахверк под ключ" }
  - { Keyword: "дом фахверк под ключ" }
  # 1–200

negative_keywords:
  Items: ["аренда", "ремонт", "бесплатно"]

_meta:
  cluster_id: "1"                  # ключ для one-per-cluster имени campaign
  intent: transactional            # informational|transactional|…
  marker_query: "фахверк под ключ"

# Вариант A (предпочтительный для ЕПК): явный пул
combinatorial:
  headlines:                       # → Titles, 1–7, каждый ≤56, слово ≤22
    - "Фахверк под ключ: 3 уровня готовности"
    - "Фахверк под ключ за 4 месяца"
    - "Рассчитайте фахверк с фикс-ценой"
  texts:                           # → Texts, 1–3, каждый ≤81, слово ≤23
    - "Тёплый контур, инженерия или отделка. Покажем состав сметы."
    - "Домокомплект 2 мес + сборка 2 мес. Фикс-цена. Гарантия 50 лет."

# Вариант B: ads[] (TEXT_AD) — пайплайн сам соберёт pool из Title/Title2/Text
ads:
  - variant_id: A
    Type: TEXT_AD
    TextAd:
      Title: "Фахверк под ключ: 3 уровня готовности"
      Title2: "Фикс-цена в договоре"
      Text: "Тёплый контур, инженерия или отделка. Покажем состав сметы."
      Href: "https://example.com/fahverk/"
      Mobile: "NO"
      # SitelinkSetId: "${sitelinks_set.Id}"   # ref после create
      # AdImageHash: "${image.img_core_v01.Hash}"

  # schema допускает RESPONSIVE_AD напрямую:
  # - Type: RESPONSIVE_AD
  #   ResponsiveAd:
  #     Titles: [...]
  #     Texts: [...]
  #     Hrefs: ["https://..."]     # в YAML-схеме массив; в API уходит singular Href

# per-group overrides (optional)
sitelinks_set:
  Sitelinks:
    - { Title: "Пакеты", Href: "https://example.com/fahverk/#packages" }

callouts:
  - "Только эта группа"
```

`ads` — **min 1** (schema). Даже при `combinatorial:` нужен хотя бы один ad (часто TEXT_AD-заглушка с Href для landing).

---

## Лимиты combinatorial (API 2026)

| Поле | Лимит |
|---|---|
| Titles / headlines | 1–7, ≤56 символов, слово ≤22 |
| Texts | 1–3, ≤81, слово ≤23 |
| Href | singular ≤1024 (API); в YAML schema — `Hrefs[]` |
| AdImageHashes | 1–5 на ad |
| RESPONSIVE_AD / группа | ≤3 non-archived (обычно **один** pool) |

## Banned (модерация)

`!!!`, `№1`, `лучший*`, `самый*`, `100%`, `гарантированно`, CAPS-заголовок, эмодзи в headline, цена без «от».

## Регионы (шпаргалка)

| ID | Регион |
|---:|---|
| 1 | Московская область (МСК+МО для показов) |
| 213 | Москва (город) |
| 2 | СПб |
| 10174 | ЛО |
| 225 | Россия |
| 0 | вся РФ (осторожно) |

---

## Поток агента

```text
1. Собрать drafts/<…>/  (_campaign.yaml + group-*.yaml)
2. yandex_direct_render_to_xlsx { folder }     # превью (optional)
3. yandex_direct_upload_from_yaml { folder, dry_run: true }
4. Проверить plan / plan_hash / counts
5. Human OK + env flags
6. yandex_direct_upload_from_yaml {
     folder, dry_run: false, plan_hash, confirm: true, acknowledge_live
   }
7. list_*/get_stats → human OK → moderate_ads
```

**Не** описывать бандл как один flat YAML с `groups: [...]` — загрузчик такого **не читает**.

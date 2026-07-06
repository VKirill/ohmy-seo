# Combinatorial ЕПК upload — YAML bundle schema

Save the draft YAML anywhere (e.g. `drafts/<client-slug>/<YYYY-MM-DD-domain>/combi-upload-draft.yaml`). Validate before upload with a separate `qa_<client>.mjs` script.

**One ad per group is a combinatorial `RESPONSIVE_AD`** — a pool of titles + texts that Yandex assembles. There are no single-title `TextAd`s, no `title2`, no per-framework separate ads. Everything targets a `UNIFIED_CAMPAIGN` on `/json/v501/`.

## Field limits (Yandex.Direct 2026, combinatorial)

| Field | Limit | Notes |
|---|---|---|
| `titles[]` | **1–7 items**, each ≤56 chars, each word ≤22 | the headline pool Yandex combines |
| `texts[]` | **1–3 items**, each ≤81 chars, each word ≤23 | the body pool |
| `href` | full URL ≤1024, **singular** | one per ad (NOT `Hrefs`) |
| `image_hashes[]` | 1–5, from `AdImages.add` | field name in API is `AdImageHashes` |
| combinatorial ads / group | **≤3 non-archived** | one pool-ad is normal (error 7001 above 3) |
| money | integer **micros** (e.g. USD×1e6) | mins from `Dictionaries.get {Currencies}` |

## Schema

```yaml
# Header — ЕПК campaign (created new; type is immutable)
campaign:
  client_login: <client_login>                # Yandex login in plain text (NOT numeric id)
  name: "epk-<client>-<theme>-v1"
  type: UNIFIED_CAMPAIGN                       # ЕПК — the only supported type
  status: DRAFT
  state: OFF
  currency: USD
  daily_budget_micros: 10000000               # $10/day (>= MinimumDailyBudget USD)
  bidding_strategy:
    search: HIGHEST_POSITION                   # manual; MUST be active (not SERVING_OFF)
    network: SERVING_OFF                        # search-only serving
  geo: "Москва и Московская область"            # → RegionIds [1] on every group
  region_ids: [1]
  href: "https://example.com/"
  callouts:                                     # → AdExtensionIds (шт. ≤ 50)
    - "Гарантия 50 лет"
    - "Свое производство"
    - "Фикс-цена в договоре"
    - "Проект бесплатно"
  minus_words_campaign:
    - "своими руками"
    - "чертежи"
    - "скачать"
    - "бесплатно"
    # ... see yandex-direct-api-quirks.md

  # OPTIONAL — ЕПК settings applied POST-CREATE to each created campaign
  # (one Campaigns.update + one bidmodifiers.add). Omit the whole block if unused.
  # On ЕПК only device (mobile/desktop/desktop_only) + video corrections apply;
  # frequency capping is NOT settable via the API.
  epk_settings:
    excluded_sites: ["bad-site.com", "spam.ru"]      # площадки-исключения РСЯ (REPLACES the list)
    negative_keywords: ["дёшево", "аналог"]           # campaign minus-words (REPLACES)
    attribution_model: AUTO                            # short codes: LC/LSC/FC/LYDC/LSCCD/FCCD/LYDCCD/AUTO
    counter_ids: [<counter_id>]                        # Metrika counter(s)
    priority_goals:                                    # цель + ценность/стоимость конверсии (micros)
      - { goal_id: <goal_id>, value: 5000000 }
    strategy:                                          # типизированная стратегия ставок
      type: pay_for_conversion                         # manual|max_clicks|avg_cpc|max_conversions|avg_cpa|pay_for_conversion|avg_crr|pay_for_conversion_crr
      placement: both                                  # search|network|both
      goal_id: <goal_id>
      cpa_micros: 5000000                              # оплата за конверсию: цена конверсии
    settings:                                          # ExtendedGeo = ENABLE_*_AREA_TARGETING
      - { Option: ENABLE_AREA_OF_INTEREST_TARGETING, Value: "YES" }
    notification:
      EmailSettings: { Email: "me@example.com", SendAccountNews: "NO", SendWarnings: "YES" }
    time_targeting:                                    # почасовое расписание показов
      ConsiderWorkingWeekends: "YES"
      Schedule:
        Items: ["1,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100"]  # "day,c0..c23"
    bid_modifiers:                                     # корректировки ставок (campaign-level)
      - { type: mobile, bid_modifier: 75 }             # −25% на мобильных
      - { type: video,  bid_modifier: 110 }            # +10% в видео

# Images uploaded once, referenced by key
images:
  img_core_v01: { source: url, url: "https://img.example.com/.../core-v01.png" }
  img_core_v02: { source: url, url: "https://img.example.com/.../core-v02.png" }

# Ad groups — each holds ONE combinatorial ad (a titles×texts pool)
groups:

  - name: "ag01_turnkey — Фахверк под ключ"
    region_ids: [1]
    href: "https://example.com/fahverk/"
    keywords:
      - "фахверк под ключ"
      - "дом фахверк под ключ"
      # ... 5–20 per group
    minus_words:
      - "аренда"
      - "ремонт"
    ad:                                          # exactly ONE combinatorial pool
      titles:                                    # 1–7, each ≤56
        - "Фахверк под ключ: 3 уровня готовности"
        - "Фахверк под ключ за 4 месяца"
        - "Рассчитайте фахверк с фикс-ценой"
        - "Дом-фахверк без скрытых работ"
        - "Фахверк с гарантией 50 лет"
        - "Фахверк со сроком 2+2 месяца"
        - "Проект и стройка фахверка под ключ"
      texts:                                     # 1–3, each ≤81
        - "Тёплый контур, инженерия или отделка. Покажем состав сметы."
        - "Домокомплект 2 мес + сборка 2 мес. Фикс-цена. Гарантия 50 лет."
        - "Гарантия 50 лет на конструктив. Производство и технадзор у подрядчика."
      image_hashes: [img_core_v01, img_core_v02] # optional; resolved to AdImageHashes
      sitelinks_set: default                      # → SitelinkSetId
      callouts_from: campaign                     # inherit campaign callouts → AdExtensionIds

  - name: "ag02_buy_build — Купить фахверк-дом"
    # ... same shape

# Sitelinks (one set, referenced by ads via SitelinkSetId)
sitelinks:
  default:
    - { title: "Уровни готовности", href: "https://example.com/fahverk/#packages", description: "Тёплый контур, инженерия или отделка" }
    - { title: "Гарантия 50 лет",  href: "https://example.com/fahverk/#warranty", description: "Закреплена в договоре" }
    # up to 8

# Summary
summary:
  campaign_type: UNIFIED_CAMPAIGN
  group_count: 22
  combinatorial_ads: 22            # one pool per group
  titles_per_ad: 7
  texts_per_ad: 3
  keyword_count_approx: 300
  status: DRAFT
  state: OFF
  currency: USD
  daily_budget_micros: 10000000
  geo: MSK+MO
  channel: "ohmy-seo → <account> / <client_login>"
```

## Banned words (always check)

| Pattern | Why |
|---|---|
| `!!!` | модерация отклонит |
| `№1` | превосходная степень |
| `лучший`, `лучшая`, `лучшее`, `лучшие` | превосходная степень |
| `самый`, `самая`, `самое`, `самые` | превосходная степень |
| `100%`, `гарантированно` | вводит в заблуждение |
| CAPS в заголовке | снижает CTR / модерация |
| Эмодзи в headline | модерация отклонит |
| Цена без «от» | нельзя гарантировать |

## QA validator pattern (qa_<client>.mjs)

Validate the pool per group **before** any API call. Same parser the uploader uses.

```js
import fs from 'node:fs';
import yaml from 'js-yaml';
const doc = yaml.load(fs.readFileSync(path, 'utf8'));
const BANNED = [/!!!/, /№1/, /лучш/i, /сам(ый|ая|ое|ые)/i, /100\s?%/, /гарантированно/i];
let problems = 0;
for (const g of doc.groups) {
  const { titles = [], texts = [] } = g.ad || {};
  if (titles.length < 1 || titles.length > 7) { console.log(`${g.name}: titles ${titles.length} (need 1–7)`); problems++; }
  if (texts.length < 1 || texts.length > 3)   { console.log(`${g.name}: texts ${texts.length} (need 1–3)`); problems++; }
  for (const t of titles) {
    if ([...t].length > 56) { console.log(`${g.name}: title >56: "${t}"`); problems++; }
    if (t.split(/\s+/).some(w => [...w].length > 22)) { console.log(`${g.name}: word >22 in title`); problems++; }
  }
  for (const t of texts) {
    if ([...t].length > 81) { console.log(`${g.name}: text >81: "${t}"`); problems++; }
    if (t.split(/\s+/).some(w => [...w].length > 23)) { console.log(`${g.name}: word >23 in text`); problems++; }
  }
  for (const s of [...titles, ...texts]) for (const re of BANNED) if (re.test(s)) { console.log(`${g.name}: banned ${re} in "${s}"`); problems++; }
}
console.log(problems ? `FAIL: ${problems} problems` : `OK: ${doc.groups.length} groups clean`);
```

Validator MUST accept the exact YAML shape the uploader consumes. If they drift, fix one — never both.

## Region ID cheat-sheet

| ID | Region |
|---:|---|
| 0 | Россия целиком (avoid unless explicitly requested) |
| 1 | Московская область |
| 2 | Санкт-Петербург |
| 213 | Москва (город) |
| 10174 | Ленинградская область |

МСК+МО = `[1]` (область включает город для показов; add `213` to force city). СПб+ЛО = `[2, 10174]`.

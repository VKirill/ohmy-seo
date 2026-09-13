# @ohmy-seo/google-ads

MCP-сервер для Google Ads API. Бинарь `mcp-google-ads`, API v25, REST + GAQL.

Реализация SPEC `docs/plans/phase-4-google-ads/SPEC.md`.

## Инструменты (37)

**OAuth (9)** — те же, что в gsc / ga4 / gtm: регистрация приложения, вход,
аккаунты по умолчанию, сервисные аккаунты.

**Чтение (8), кэш 1–24 ч**

`ads_list_accessible_customers` · `ads_get_customer` · `ads_list_campaigns` ·
`ads_list_ad_groups` · `ads_list_ads` · `ads_list_keywords` ·
`ads_list_negative_keywords` · `ads_list_budgets`

**GAQL и отчёты (7), кэш 1–24 ч**

`ads_run_query` · `ads_resource_metadata` · `ads_search_terms_report` ·
`ads_keyword_performance_report` · `ads_campaign_performance_report` ·
`ads_change_history` · `ads_recommendations`

**Запись без риска (6)** — предпросмотр по умолчанию, нужен `confirm: true`

`ads_create_campaign_budget` · `ads_create_campaign` (всегда PAUSED) ·
`ads_create_ad_group` · `ads_add_keywords` · `ads_add_negative_keywords` ·
`ads_apply_recommendation`

**DANGER (7)** — тратят деньги или удаляют

`ads_enable_campaign` · `ads_pause_campaign` · `ads_update_budget` ·
`ads_remove_keywords` · `ads_remove_negative_keywords` · `ads_remove_ads` ·
`ads_remove_campaign`

## Три замка на опасных операциях

1. `confirm: false` (по умолчанию) — возвращается предпросмотр, ничего не происходит
2. `acknowledge_live` вида `I-UNDERSTAND-THIS-IS-LIVE:<customer_id>:<resource>` —
   эхо цели, поэтому токен из прошлого вызова не сработает на другом аккаунте
3. `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true` в `.env` — общий рубильник, по умолчанию выключен

Плюс `validate_only: true` на обычных мутациях — Google проверяет операцию и ничего не пишет.

## Что делает GAQL-слой

- **Первичные поля.** `keyword_view` требует `ad_group_criterion.criterion_id`,
  `search_term_view` — `search_term_view.search_term`. Запрос без них отклоняется
  до отправки, а не Гуглом.
- **Дата и LIMIT.** Метрики без диапазона дат дают пожизненные тоталы — на это
  выдаётся предупреждение; LIMIT подставляется, если его нет.
- **Микро-валюты.** К каждому `*Micros` добавляется `*Readable` в валюте аккаунта.
  Плюс `averageCpc` и `costPerConversion`, которые приходят в микро, но по имени
  этого не видно.
- **Подсказки по ошибкам.** `CUSTOMER_NOT_ENABLED`, `USER_PERMISSION_DENIED`,
  `EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE` и другие переводятся в понятную строку.
- **Ответ обрезается** на 25 000 символах, чтобы не съесть контекст модели.

## Доступ к аккаунтам

Запрос сначала идёт напрямую, при отказе по правам повторяется с заголовком
`login-customer-id` из `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. Работает и с аккаунтами
на прямом доступе, и с привязанными к MCC.

## Переменные окружения

| Переменная | Зачем |
|---|---|
| `MCP_GOOGLE_ADS_MASTER_KEY` | 64 hex-символа, шифрование токенов |
| `MCP_YANDEX_SEO_MASTER_KEY` | то же значение — ядро шифрует ключом с зашитым именем, см. ниже |
| `MCP_GOOGLE_ADS_DB_PATH` | абсолютный путь к `state.db` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | токен из Центра API Google Рекламы |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | MCC без дефисов |
| `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` | `false` по умолчанию |
| `MCP_GOOGLE_ADS_CACHE_TTL_META` / `_REPORT` | 86400 / 3600 |
| `MCP_GOOGLE_ADS_OAUTH_LOOPBACK_PORT` | 8767, чтобы не пересекаться с ga4 |

## Известное расхождение с ядром

`packages/core/src/crypto/master-key.ts` читает переменную с жёстко зашитым
именем `MCP_YANDEX_SEO_MASTER_KEY`, игнорируя пер-пакетный ключ из
`resolvePackageConfig`. Пока это так, в `.env` дублируется то же значение под
обоими именами. Чинить надо в ядре — это касается и gsc, и ga4, и gtm.

## Скрипты

```
npx tsx scripts/import-existing-token.ts   # перенести уже выданный refresh token
npx tsx scripts/smoke-live.ts              # живая проверка на боевых аккаунтах
npx tsx scripts/test-json-safe.ts          # регрессия на длинные дроби
node scripts/install-into-claude.mjs       # прописать сервер в Claude Desktop
```

# @ohmy-seo/google-ads

MCP-сервер для Google Ads API. Бинарь `mcp-google-ads`, API v25, REST + GAQL.

Реализация SPEC `docs/plans/phase-4-google-ads/SPEC.md`.

## Инструменты (44)

**OAuth (9)** — те же, что в gsc / ga4 / gtm: регистрация приложения, вход,
аккаунты по умолчанию, сервисные аккаунты.

**Чтение (9), кэш 1–24 ч**

`ads_list_accessible_customers` · `ads_get_customer` · `ads_list_campaigns` ·
`ads_list_ad_groups` · `ads_list_ads` · `ads_list_keywords` ·
`ads_list_negative_keywords` · `ads_list_budgets` · `ads_list_shared_sets`

**GAQL и отчёты (7), кэш 1–24 ч**

`ads_run_query` · `ads_resource_metadata` · `ads_search_terms_report` ·
`ads_keyword_performance_report` · `ads_campaign_performance_report` ·
`ads_change_history` · `ads_recommendations`

**Управляемая запись (10)** — предпросмотр по умолчанию; для выполнения нужны `confirm: true` и env-флаг

`ads_create_campaign_budget` · `ads_create_campaign` (всегда PAUSED) ·
`ads_add_campaign_criteria` · `ads_create_ad_group` · `ads_add_keywords` ·
`ads_add_negative_keywords` · `ads_create_ad` · `ads_update_ad_group` ·
`ads_update_campaign` · `ads_attach_shared_set`

**DANGER (9)** — могут менять расходы, охват или удалять данные

`ads_enable_campaign` · `ads_pause_campaign` · `ads_update_budget` ·
`ads_remove_keywords` · `ads_remove_negative_keywords` · `ads_remove_ads` ·
`ads_remove_campaign` · `ads_detach_shared_set` · `ads_apply_recommendation`

## Защита записи

1. `confirm: false` (по умолчанию) — возвращается предпросмотр, ничего не происходит
2. Любая реальная запись требует `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true`; `validate_only` разрешён без него
3. DANGER дополнительно требует `acknowledge_live` вида `I-UNDERSTAND-THIS-IS-LIVE:<customer_id>:<resource>` —
   эхо цели, поэтому токен из прошлого вызова не сработает на другом аккаунте

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
| `MCP_GOOGLE_ADS_DB_PATH` | абсолютный путь к `state.db` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | устаревший необязательный заголовок для старых конфигураций |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | MCC без дефисов |
| `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` | `false` по умолчанию |
| `MCP_GOOGLE_ADS_CACHE_TTL_META` / `_REPORT` | 86400 / 3600 |
| `MCP_GOOGLE_ADS_OAUTH_LOOPBACK_PORT` | 8767, чтобы не пересекаться с ga4 |

С 9 сентября 2026 года Google привязывает уровень доступа API к Google Cloud project, который владеет OAuth credentials. Developer token больше не требуется; для production-аккаунтов Cloud project должен получить соответствующий уровень доступа.

## Проверка

`pnpm --filter @ohmy-seo/google-ads test` запускает тесты GAQL metadata-запросов и защитных блокировок.

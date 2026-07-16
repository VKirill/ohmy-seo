# ohmy-seo

<p align="center">
  <img src="docs/assets/hero.svg" alt="ohmy-seo: MCP-серверы для Яндекса и Google" width="100%">
</p>

**Монорепозиторий MCP-серверов** для SEO и performance-маркетинга. Агент (Claude Code / Claude Desktop / любой MCP-клиент) получает «руки» к живым кабинетам:

| Платформа | Сервер | Что делает |
|---|---|---|
| **Яндекс** | `mcp-yandex-seo` | Директ (ЕПК), Метрика, Вебмастер |
| **Mutagen.ru** | `mcp-mutagen` | конкуренция ключей, mass-parser, SERP-отчёты |
| **XMLStock** | `mcp-xmlstock` | live SERP Яндекс/Google + архив |
| **Google** | `mcp-gsc` · `mcp-ga4` · `mcp-gtm` | Search Console, Analytics 4, Tag Manager |

> ⚠️ Серверы ходят в **живые** рекламные и аналитические аккаунты. Запись закрыта env-флагами **и** `confirm` на каждый вызов. Токены — AES-256-GCM в локальной SQLite.

**MIT © 2026 [Кирилл Вечкасов](https://github.com/VKirill)** · v0.8.0

---

## Пакеты

| Пакет | Версия | MCP | Назначение |
|---|---|---|---|
| `@ohmy-seo/yandex-seo` | **0.8.0** | `mcp-yandex-seo` | Яндекс Директ (ЕПК/комбинаторика), Метрика, Вебмастер |
| `@ohmy-seo/mutagen` | 0.1.0 | `mcp-mutagen` | Конкуренция ключей (Mutagen.ru) |
| `@ohmy-seo/xmlstock` | 0.2.0 | `mcp-xmlstock` | SERP Яндекс/Google (XMLStock) |
| `@ohmy-seo/google-search-console` | 0.1.0 | `mcp-gsc` | Google Search Console + Indexing API |
| `@ohmy-seo/ga4` | 0.1.0 | `mcp-ga4` | GA4 Data API + Admin API |
| `@ohmy-seo/gtm` | 0.1.0 | `mcp-gtm` | Google Tag Manager (read/write/publish/rollback) |
| `@ohmy-seo/mcp-core` | 0.3.0 | — | OAuth storage, SQLite cache, big-int JSON, base types |

---

## `mcp-yandex-seo` — флагман (Яндекс)

<img src="docs/assets/yandex-seo.svg" alt="mcp-yandex-seo: Директ, Метрика, Вебмастер" width="100%">

### Яндекс Директ (ЕПК)

В Директе форматы сведены в **Единую перформанс-кампанию**. Сервер — **только комбинаторика**: `RESPONSIVE_AD` с пулом **1–7 заголовков × 1–3 текстов** через `/json/v501/`. Классические `TextAd` / `TextImageAd` не используются.

| Область | Tools (реальные имена) |
|---|---|
| Загрузка кампании | `yandex_direct_upload_from_yaml`, `yandex_direct_upload_campaign_bundle`, `yandex_direct_render_to_xlsx` |
| Создание | `yandex_direct_create_campaign`, `…_adgroup`, `…_ad_unified`, `…_sitelinks_set`, `…_promo_extension`, `…_upload_image` |
| Point-edit | `yandex_direct_update_campaign`, `…_adgroup`, `…_ad`, `…_budgets`, `…_adgroup_autotargeting` |
| Ставки / корректировки | `yandex_direct_set_bid_modifiers` (mobile/desktop/video), typed `strategy` |
| Управление | `yandex_direct_pause_campaigns`, `…_resume_campaigns`, `…_delete_campaigns`, `…_moderate_ads` |
| Таргет / минус | `yandex_direct_negative_keywords_add`, `…_feeds` |
| Чтение / отчёты | `yandex_direct_list_*`, `…_get_stats`, `…_get_search_terms`, `…_get_change_history` |
| Raw API | `yandex_direct_api` (любой метод v5/v501) |

Деньги — целые **микроединицы** (RUB/USD/EUR…), минимумы из `Dictionaries.get{Currencies}`.

### Яндекс Метрика и Вебмастер

| Область | Tools |
|---|---|
| Метрика | `yandex_metrika_api`, `list_counters`, `yandex_direct_link_metrika_goals` |
| Вебмастер | `yandex_webmaster_api`, `list_sites`, `find_property` |
| Инвентарь / кэш | `refresh_inventory`, `cache_stats`, `invalidate_cache` |
| OAuth | `register_oauth_app` → `start_oauth_flow` → `complete_oauth_flow`, multi-account |

**Скилл агента:** [`skills/ohmy-seo-mcp/`](skills/ohmy-seo-mcp/) — каталог tools, YAML-рецепт, point-edit playbook, [API quirks](skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md).

---

## `mcp-mutagen` — конкуренция ключей

<img src="docs/assets/mutagen.svg" alt="mcp-mutagen: Mutagen.ru" width="100%">

| Tool | Назначение |
|---|---|
| `mutagen_competition` | конкуренция / частотность по фразам |
| `mutagen_parser_mass` / `mutagen_parser_get` | массовый парсер |
| `mutagen_serp_report` | SERP-отчёт |
| `mutagen_api` | raw gateway к API Mutagen.ru |

Нужен `MUTAGEN_API_KEY`.

---

## `mcp-xmlstock` — SERP Яндекс / Google

<img src="docs/assets/xmlstock.svg" alt="mcp-xmlstock: SERP" width="100%">

| Tool | Назначение |
|---|---|
| `xmlstock_yandex_serp` | live-выдача Яндекса (позиции, сниппеты) |
| `xmlstock_google_serp` | live-выдача Google |
| `xmlstock_archive_search` / `xmlstock_archive_get` | историческая SERP |
| `xmlstock_usage_stats` | расход лимитов |

Нужны `XMLSTOCK_USER` + `XMLSTOCK_KEY`.

---

## Google: Search Console · GA4 · GTM

### `mcp-gsc` — Search Console + Indexing

<img src="docs/assets/gsc.svg" alt="mcp-gsc: Google Search Console" width="100%">

| Tool | Назначение |
|---|---|
| `gsc_search_analytics` | показы, клики, CTR, позиция (page/query/device/country) |
| `gsc_url_inspection` | инспекция URL, статус индексации |
| `gsc_list_sites` | список property |
| `gsc_list_sitemaps` / `gsc_submit_sitemap` / `gsc_delete_sitemap` | sitemap |
| `gsc_indexing_publish` | Indexing API |

### `mcp-ga4` — Analytics 4

<img src="docs/assets/ga4.svg" alt="mcp-ga4: Google Analytics 4" width="100%">

| Tool | Назначение |
|---|---|
| `ga4_run_report` / `ga4_batch_run_reports` / `ga4_run_pivot_report` | Data API |
| `ga4_run_realtime_report` | realtime (~30 мин) |
| `ga4_list_properties` | property lookup |
| `ga4_get_metadata` | dimensions/metrics metadata |
| `ga4_list_custom_dimensions` / `ga4_list_conversion_events` | Admin API |

### `mcp-gtm` — Tag Manager

<img src="docs/assets/gtm.svg" alt="mcp-gtm: Google Tag Manager" width="100%">

| Tool | Назначение |
|---|---|
| `gtm_list_containers` / `gtm_list_workspaces` | структура аккаунта |
| `gtm_list_tags` / `gtm_create_tag` / `gtm_update_tag` / `gtm_delete_tag` | теги |
| `gtm_list_triggers` / `gtm_create_trigger` | триггеры |
| `gtm_list_variables` / `gtm_create_variable` | переменные |
| `gtm_create_version` / `gtm_publish_version` / `gtm_rollback` | релизы |

Google-пакеты: OAuth (`register_google_oauth_app` → `start_google_oauth_flow` → `complete_google_oauth_flow`) или `register_google_service_account`.

---

## Установка

```bash
git clone https://github.com/VKirill/ohmy-seo.git
cd ohmy-seo
pnpm install          # Node.js ≥ 22, pnpm
pnpm -r build
pnpm -r test          # опционально
```

### Конфиг `mcp-yandex-seo`

```bash
cp packages/yandex-seo/.env.example packages/yandex-seo/.env
```

| Переменная | Назначение |
|---|---|
| `MCP_YANDEX_SEO_MASTER_KEY` | 32-byte hex AES-256-GCM (`openssl rand -hex 32`). Без ключа токены не восстановить. |
| `OHMY_SEO_ALLOW_LIVE_MUTATIONS` | глобальный kill-switch записи (`true` / unset = read-only) |
| `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS` | запись в Яндекс Директ |

Опционально: `MUTAGEN_API_KEY`, `XMLSTOCK_USER` + `XMLSTOCK_KEY`. Google — см. `.env.example` пакета.

### OAuth (Яндекс)

1. `register_oauth_app` — client_id + client_secret (шифруются)
2. `start_oauth_flow` → браузер
3. `complete_oauth_flow` → токены
4. `list_accounts` / `set_default_account`; для агентств — `client_login`

### MCP-клиент

```json
{
  "mcpServers": {
    "mcp-yandex-seo": {
      "command": "node",
      "args": ["/absolute/path/to/ohmy-seo/packages/yandex-seo/dist/index.js"]
    }
  }
}
```

```bash
claude mcp add mcp-yandex-seo -- node /absolute/path/to/ohmy-seo/packages/yandex-seo/dist/index.js
```

После подключения перезапустите клиент.

---

## Безопасность записи

1. `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true`
2. `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` (платформенный флаг)
3. `confirm: true` на каждом mutating tool
4. `acknowledge_live` — точная строка для delete / pause / moderate / budget / удаления корректировок

Рекомендация агентам: создавать в **DRAFT/OFF**, только поиск, ручная/низкий weekly cap, **без автомодерации и автозапуска**.

Токены и client secret — в `data/state.db` (AES-256-GCM, gitignored). `.env` и `client_secret_*.json` не коммитить.

---

## Разработка

```bash
pnpm -r build
pnpm --filter @ohmy-seo/yandex-seo test
pnpm -r exec tsc --noEmit
```

Структура `yandex-seo`: `src/registry/*` · `src/tools/*` · `src/lib/payloads/*` · `src/lib/pipeline/*`.  
Quirks API: [`skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md`](skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md).

---

## Авторские права и лицензия

**Copyright © 2026 Кирилл Вечкасов (Kirill Vechkasov, [@VKirill](https://github.com/VKirill))**

Код, документация, skill и ассеты в `docs/assets/` — автора. Товарные знаки Яндекс, Google, Mutagen, XMLStock принадлежат правообладателям; проект с ними не аффилирован.

[MIT](LICENSE) — использование, изменение и распространение с сохранением copyright notice.

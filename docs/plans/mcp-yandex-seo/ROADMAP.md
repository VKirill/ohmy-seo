# mcp-yandex-seo — Multi-version Roadmap

Дата: 2026-05-17.
Контекст: v0.1.0 завершён (7 read-only tools, single token in .env). Этот документ задаёт
направление v0.2–v0.5. Каждая версия получит отдельный SPEC.md при подходе очереди.

## Зафиксированные архитектурные решения

| # | Вопрос | Решение |
|---|---|---|
| 1 | Где хранить SQLite | Внутри проекта: `data/state.db`, права 0600, в .gitignore |
| 2 | OAuth flow | Authorization Code с `redirect_uri=https://oauth.yandex.ru/verification_code` (out-of-band). User копирует 7-симв. код, MCP меняет на access+refresh tokens |
| 3 | Миграция с v0.1 | **Breaking**. v0.2 удаляет `YANDEX_OAUTH_TOKEN`/`WEBMASTER_USER_ID`/`METRIKA_COUNTER_ID`/`DIRECT_CLIENT_LOGIN` полностью. Пользователь заново подключает аккаунт через oauth flow |
| 4 | Direct token routing | Tools, требующие scope `direct:api`, ищут account: (a) явно указанный → (b) is_default → (c) единственный кандидат. Если кандидатов несколько и нет default — ошибка с подсказкой |
| 5 | Шифрование секретов | v0.2–v0.4: AES-256-GCM, ключ из `MCP_YANDEX_SEO_MASTER_KEY` env. v0.5: миграция в OS keychain (`keytar`) |
| 6 | Mutagen | Остаётся как в v0.1: один API-ключ в .env (`MUTAGEN_API_KEY`), не участвует в multi-account |
| 7 | Развёртывание roadmap | Версия за версией — SPEC только на текущую. Не пытаемся залить v0.3+ в один SPEC до завершения v0.2 |

## Mental model

```
OAuth-app  (oauth_apps table)        — "приложение" с oauth.yandex.ru
   ├─ label                            "SEO", "SEO+Direct", "Direct"
   ├─ client_id + client_secret_enc
   └─ scopes_declared                  что app может запросить

Account    (accounts table)          — авторизация Яндекс-логина через конкретный OAuth-app
   ├─ label                            "kirill-main", "kirill-direct", "client-acme"
   ├─ oauth_app_id  → oauth_apps
   ├─ yandex_login                     заполняется по факту после первого вызова
   ├─ access_token_enc + refresh_token_enc + expires_at
   ├─ scopes_granted                   что юзер реально разрешил
   └─ is_default                       fallback когда tool не получил account явно
```

Один и тот же физический Яндекс-аккаунт может быть подключён дважды через 2 разных
OAuth-app — это 2 разных row в `accounts` (разные токены, разный scope).

## Версии

### v0.2 — Multi-account через OAuth-app (next)

**Цель:** убрать env-driven single token, ввести БД OAuth-app + accounts, реализовать
полный oauth code-flow с refresh, прокинуть `account?` во все доменные tools.

**Объём:** ~800 LOC, ≤8 новых oauth-tools, ≤5 новых lib-модулей.

**SPEC будет в:** `docs/plans/mcp-yandex-seo/SPEC-v0.2.md`

**Out-of-scope для v0.2:**
- Inventory cache (sites/counters/campaigns) — это v0.3
- Query result cache (Wordstat/Mutagen) — это v0.4
- OS keychain encryption — это v0.5
- `find_property` fuzzy search — это v0.3

### v0.3 — Inventory cache 24h

**Цель:** при подключении аккаунта (или по `refresh_inventory`) MCP сам узнаёт
список сайтов/счётчиков/Direct-клиентов, кладёт в `inv_*` таблицы, TTL 24ч,
stale-while-revalidate. Доменные tools принимают `site` (string) вместо строгого `host_id`.

**Новые tools:** `list_sites`, `list_counters`, `list_direct_clients`, `find_property(query, kind?)`, `refresh_inventory(account?, kind?)`.

**TTL:** `MCP_YANDEX_SEO_CACHE_TTL_HOURS=24` (env, дефолт 24).

### v0.4 — Query result cache + smart routing

**Цель:** кешировать результаты по args-hash:
| Tool | TTL |
|---|---|
| `wordstat_keywords` | 7 дней |
| `mutagen_competition` | 30 дней |
| `webmaster_top_queries`, `metrika_search_phrases` | 1 час |
| `webmaster_site_summary`, `metrika_traffic_summary` | 6 часов |
| `webmaster_indexing_issues` | 1 час |

Каждый tool получает опц. `force_refresh: bool`. Новые мета-tools: `invalidate_cache`,
`cache_stats`.

### v0.5 — Production hardening

- Перенос master-key в OS keychain (`keytar`)
- `oauth_events` audit log
- `check_health()` tool — пингует light endpoints всех аккаунтов
- Чёткие миграции v0.2→0.3→0.4→0.5 (better-sqlite3 migration runner)

## Открытые вопросы для будущих версий (не блокеры)

- **Direct sandbox vs production routing per account** — сейчас флаг глобальный
  (`DIRECT_USE_SANDBOX` env). В v0.2+ возможно нужен per-account override.
- **Rate-limit awareness между аккаунтами** — Яндекс лимиты application-wide,
  не per-account. Если 5 accounts на одном OAuth-app параллельно дёргают Metrika —
  можем поймать 429. Учесть при inventory refresh batching.
- **Token-leak в логи sub-process'ов** — current sanitizer покрывает stdout/stderr,
  но не покрывает crash dumps. Невысокий риск, учесть в v0.5 hardening.

## Глоссарий

- **OAuth-app**: запись в `oauth_apps`, представляет приложение на oauth.yandex.ru
- **Account**: запись в `accounts`, представляет авторизацию Яндекс-логина через OAuth-app
- **Token broker**: модуль `lib/token-broker.ts`, возвращает свежий access_token по account_id, авторефрешит если истёк
- **Inventory** (v0.3+): локально кешированный список ресурсов аккаунта (sites/counters/clients)
- **OOB flow**: Out-of-band OAuth — Яндекс показывает code на странице, user копирует вручную

# SPEC: mcp-yandex-seo (v0.1.0)

## Goal

MCP-сервер для Claude Code, дающий SEO-агенту в RU-сегменте 7 ежедневных инструментов поверх Яндекс.Вебмастера / Метрики / Директа / Mutagen, объединённых общим Yandex OAuth.

## Scope (v0.1.0) — 7 tools

| # | Tool | API | Что делает |
|---|---|---|---|
| 1 | `webmaster_site_summary` | Webmaster v4 | Сводка по хосту: SQI, проблемы, кол-во страниц в индексе, последний обход. |
| 2 | `webmaster_top_queries` | Webmaster v4 | Топ поисковых запросов: показы, клики, CTR, средняя позиция. |
| 3 | `webmaster_indexing_issues` | Webmaster v4 | Список диагностических проблем сайта (errors/warnings/critical). |
| 4 | `metrika_search_phrases` | Metrika API | Топ поисковых фраз (источник=organic): визиты + отказы + глубина. |
| 5 | `metrika_traffic_summary` | Metrika API | Сводка трафика: визиты/посетители/просмотры по источникам. |
| 6 | `wordstat_keywords` | Direct API v5 (Wordstat) | Keyword research: частотности и связанные запросы по фразе/региону. |
| 7 | `mutagen_competition` | Mutagen | Уровень конкуренции для списка запросов (1-25) + cost. |

## Out of scope (v0.1.0)

- Google Search Console / GA4 / Bing Webmaster Tools — отдельные MCP (гибридная архитектура).
- XMLStock SERP scraping — отдельный MCP.
- Управление кампаниями Директа (Campaigns/Ads/Bids) — это PPC, не SEO.
- Write-операции в Вебмастере (sitemap upload, переобход URL).
- OAuth-флоу получения токена через UI — токен заводится один раз вручную в `.env`.
- Кэширование, batching, retry с экспоненциальным бэкоффом сверх минимально нужного.
- HTTP/SSE-транспорт, PM2-деплой — только stdio.

## Architecture

### Структура каталогов

```
mcp-yandex-seo/
├── src/
│   ├── index.ts                       # MCP bootstrap + tool registration
│   ├── lib/
│   │   ├── yandex-oauth.ts            # общий OAuth helper
│   │   ├── http.ts                    # undici fetch + error mapping
│   │   ├── webmaster-client.ts        # Webmaster API v4
│   │   ├── metrika-client.ts          # Metrika API
│   │   ├── direct-client.ts           # Direct API v5 (Wordstat only)
│   │   ├── mutagen-client.ts          # Mutagen
│   │   └── errors.ts                  # AuthError, RateLimitError, ApiError
│   ├── tools/
│   │   ├── webmaster-site-summary.ts
│   │   ├── webmaster-top-queries.ts
│   │   ├── webmaster-indexing-issues.ts
│   │   ├── metrika-search-phrases.ts
│   │   ├── metrika-traffic-summary.ts
│   │   ├── wordstat-keywords.ts
│   │   └── mutagen-competition.ts
│   └── smoke.ts
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### Ключевые архитектурные решения

- **Общий OAuth-helper.** `yandex-oauth.ts` экспортирует `authHeader()` для Webmaster/Metrika и `bearerHeader()` для Direct (если потребуется Bearer).
- **Mutagen — отдельная авторизация** через `MUTAGEN_API_KEY` query-param.
- **HTTP-слой тонкий.** `http.ts` — undici.fetch + AbortController timeout + mapping 401/429/4xx/5xx в типизированные ошибки. Без retry в v0.1.0.
- **Клиенты — чистые.** Не знают про MCP/Zod/tool-handlers, возвращают узкие типы.
- **Tools — тонкие.** Один файл = одна функция `runX(input)`.
- **Логи только в stderr.** stdout зарезервирован под JSON-RPC. Секреты никогда не печатаются.
- **Errors маппятся в текст для модели** через `errorToMcpContent`.

## Env vars (.env.example)

```dotenv
# === Yandex OAuth (общий для Webmaster + Metrika + Direct) ===
YANDEX_OAUTH_TOKEN=

# === Webmaster ===
WEBMASTER_USER_ID=

# === Metrika ===
METRIKA_COUNTER_ID=

# === Direct (Wordstat) ===
DIRECT_CLIENT_LOGIN=
DIRECT_USE_SANDBOX=false

# === Mutagen ===
MUTAGEN_API_KEY=

# === Optional ===
HTTP_TIMEOUT_MS=30000
```

## Acceptance criteria

- [ ] `npm run build` зелёный, `tsc --noEmit` без ошибок.
- [ ] `npm start` стартует, печатает `mcp-yandex-seo v0.1.0 running via stdio` в stderr.
- [ ] Все 7 tools зарегистрированы, описания ≥ 150 символов каждое.
- [ ] `npm run smoke` отрабатывает каждый tool с реальными ключами и печатает OK/FAIL.
- [ ] Отсутствие обязательного env даёт понятную ошибку, не stack trace.
- [ ] `.env` в `.gitignore`, `.env.example` присутствует.
- [ ] Secret-leak audit: маркер из `.env` не появляется в stderr/dist.
- [ ] 401 от Яндекса → `isError:true` с подсказкой обновить токен.
- [ ] 429/Retry-After мапится в `isError:true` с подсказкой подождать.
- [ ] README с инструкциями подключения через `claude mcp add`.
- [ ] File budgets соблюдены.

## Checklist (10 tasks)

1. Bootstrap package (package.json, tsconfig, .gitignore, .env.example, пустой README)
2. Подтвердить детали API (Webmaster paths, Direct Bearer/OAuth, Wordstat async, Mutagen response shape)
3. Каркас MCP (src/index.ts с заглушками 7 tools, lib/yandex-oauth.ts, lib/errors.ts, lib/http.ts)
4. Webmaster client + 3 tools
5. Metrika client + 2 tools
6. Direct (Wordstat) client + tool
7. Mutagen client + tool
8. Secret-leak audit
9. README + .env.example финал
10. Smoke full run + acceptance review

## File budgets

| File | Target | Hard cap |
|---|---|---|
| src/index.ts | 170 | 200 |
| src/lib/yandex-oauth.ts | 50 | 100 |
| src/lib/http.ts | 80 | 150 |
| src/lib/errors.ts | 50 | 100 |
| src/lib/webmaster-client.ts | 200 | 250 |
| src/lib/metrika-client.ts | 150 | 250 |
| src/lib/direct-client.ts | 200 | 250 |
| src/lib/mutagen-client.ts | 80 | 150 |
| src/tools/*.ts (×7) | 50-70 | 150 |
| src/smoke.ts | 180 | 300 |
| README.md | 150 | 250 |

Total ~2000 LOC.

## Dependencies

- runtime: `@modelcontextprotocol/sdk@^1.12.1`, `zod@^3.24.2`, `dotenv@^16.4.5`, `undici@^6.21.0`
- dev: `@types/node@^22`, `tsx@^4.19.3`, `typescript@^5.7.3`

## Risk register

| Риск | Митигация |
|---|---|
| OAuth-токен Яндекса истёк | AuthError handler + README |
| Direct требует Bearer вместо OAuth | Раздельные `authHeader()` и `bearerHeader()` |
| Wordstat polling зависает | `poll_timeout_sec` + `DeleteWordstatReport` в finally |
| Mutagen списывает баланс на smoke | `SMOKE_MUTAGEN=1` opt-in |
| Metrika quota 5000/сутки | RateLimitError → понятное сообщение |
| Утечка токена в логи | Step 8 — обязательный leak audit |

## Open questions (закрываются в Task 2)

1. Direct API: `Bearer` vs `OAuth` в Authorization?
2. Webmaster diagnostics endpoint: `/diagnostics/` vs `/insights/`?
3. Mutagen: `balance` в каждом ответе или отдельный запрос?
4. Webmaster hostId формат (`https:example.com:443`)?

Все 4 решаются 30 минутами чтения публичной документации.

# SPEC: ohmy-seo Phase 2 — extract `@ohmy-seo/seo-parsers` + XMLStock SERP

## 1. Goal

Вынести Mutagen из `@ohmy-seo/yandex-seo` в новый sibling-пакет `@ohmy-seo/seo-parsers` и добавить туда же XMLStock SERP-парсер для Яндекса и Google. Пакет `yandex-seo` остаётся домом для аналитики собственных Яндекс-проперти (Webmaster/Metrika/Direct + OAuth), `seo-parsers` становится домом для внешней SERP-разведки. Phase 2 закрепляет паттерн «sibling-пакет с собственным MCP-сервером, БД и smoke» — он повторно применяется в Phase 4 (`@ohmy-seo/youtube`) и Phase 5 (`@ohmy-seo/threads`).

## 2. Why now

- Mutagen — это SERP-парсер чужой выдачи, а не API собственных Яндекс-сервисов; концептуально он не на месте.
- XMLStock закрывает разрыв: даёт топ-100 с позициями/тайтлами/сниппетами для Яндекса **и** Google по цене ≈18 руб/1000 запросов, без своих прокси и капч.
- Раздельная композиция: `yandex-seo` = «мои Яндекс-проперти», `seo-parsers` = «внешний SERP-интеллект». Это снимает путаницу пользователя при выборе MCP-сервера.
- Phase 2 — канонический шаблон для будущих sibling-пакетов. Если декомпозиция сейчас аккуратная, Phase 4-5 копируют её 1-в-1.
- БД пакета изолирована: ключи XMLStock и Mutagen не попадают в `yandex-seo/data/state.db`, где живут OAuth-токены.

## 3. Out of scope

- Новые Mutagen-инструменты или изменение их контракта — Variant A, чистый relocate.
- XMLStock suggests, images, news, video, scroller, ads — только SERP (Яндекс XML и Google XML) + balance в MVP.
- `@ohmy-seo/google-seo` (отдельная Phase 3 для GSC / Google Analytics через OAuth).
- `@ohmy-seo/youtube` (Phase 4), `@ohmy-seo/threads` (Phase 5).
- Рефакторинг `mcp-core` или api-gateway endpoints-spec.
- Async-режим XMLStock (`delayed=1` + req_id polling) — для MVP только hybrid (`yandex/xml/` GET с retry на код 210, ≥20 с между ретраями).
- Перевод Mutagen на api-gateway pattern (сейчас у Mutagen свой `mutagen-client.ts`, оставляем как есть).

## 4. Architecture decisions

### 4.1. XMLStock client — отдельный, не через api-gateway

- **Выбор:** `packages/seo-parsers/src/lib/xmlstock-client.ts` — собственный HTTP-клиент поверх `@ohmy-seo/mcp-core/http`. Зеркало паттерна `mutagen-client.ts`.
- **Альтернатива:** прогнать XMLStock через generic api-gateway (как `yandex_metrika_api`).
- **Почему нет:** api-gateway построен под OAuth Bearer + кэш по `account_id`. XMLStock — статический `user`+`key` в query-string, без аккаунтов. Натягивать его на gateway даёт +50 строк маппинга без выгоды.
- **Риск:** два паттерна работы с внешними API в одном пакете. Митигация — оба инструмента используют `withCache` из `mcp-core`, разница только на уровне HTTP-вызова.

### 4.2. Аутентификация и хранение ключей — env, БД пустая на старте

- **Выбор:** `XMLSTOCK_USER`, `XMLSTOCK_KEY`, `MUTAGEN_API_KEY` в `.env` пакета. Single-tenant, как сейчас в Mutagen.
- **Альтернатива:** шифрованное хранение в `packages/seo-parsers/data/state.db` через `@ohmy-seo/mcp-core/crypto`.
- **Почему env:** добавлять multi-tenant к ключам, которые не ротируются и не привязаны к пользователю, — преждевременная сложность. Когда понадобится мультиаккаунт XMLStock (например агентство с несколькими ЛК), вернёмся.
- **Что закладываем:** в БД создаём только таблицу `query_cache` (миграция из `mcp-core`). Сама таблица `api_keys` НЕ создаётся в Phase 2.

### 4.3. Собственная БД пакета

- **Выбор:** `packages/seo-parsers/data/state.db`, изолированная от `yandex-seo/data/state.db`.
- **Альтернатива:** общая БД на корне монорепо.
- **Почему изоляция:** mirrors yandex-seo. Каждый MCP-сервер — самодостаточная единица: своя БД, свой master-key, свой smoke. Это упрощает удаление пакета и не пересекает кэши.
- **Master-key:** XMLStock-кэш ничего секретного не хранит (это публичные SERP), но `mcp-core/db` требует `MCP_SEO_PARSERS_MASTER_KEY` для symmetry. Сгенерировать `openssl rand -hex 32`.

### 4.4. Кэш-политика

- **Mutagen:** TTL 30 дней (как сейчас). Не меняем.
- **XMLStock SERP:** TTL **24 часа** (`MCP_SEO_PARSERS_CACHE_TTL_XMLSTOCK_SERP=86400`). SERP волатильна, но 1 запрос стоит денег — сутки разумный компромисс между свежестью и расходом баланса.
- **XMLStock balance:** TTL **5 минут** (`MCP_SEO_PARSERS_CACHE_TTL_XMLSTOCK_BALANCE=300`). XMLStock не даёт прямого endpoint баланса — придётся либо парсить ЛК (out of scope), либо использовать косвенный сигнал из ответа `error 200`. Реалистичный путь: balance-tool возвращает «нет прямого API; смотри ЛК xmlstock.com», плюс счётчик потраченных кредитов из локального лога. Решение — minimal balance tool с TTL 5 мин и явной пометкой.
- **force_refresh:** boolean на каждом XMLStock-инструменте, как у Yandex generic gateways.

### 4.5. Расширение `CACHEABLE_TOOLS` в `mcp-core`

- **Проблема:** `packages/core/src/cache/cache-policy.ts` хардкодит список cacheable-инструментов:
  ```ts
  export const CACHEABLE_TOOLS = ["yandex_metrika_api", ...] as const;
  ```
- **Выбор:** добавить в этот список `"xmlstock_yandex_serp"`, `"xmlstock_google_serp"`, `"xmlstock_balance"`. Это **минимальное** изменение `mcp-core` — расширение enum + добавление TTL-defaults.
- **Бамп версии core:** `0.x → 0.(x+1)` (точечно — `0.2.0`, если сейчас `0.1.0`). Уточнить из package.json при реализации.
- **Альтернатива:** перевести `CACHEABLE_TOOLS` в open enum (`string`), параметризовать TTL через registerCacheableTool(). Откладываем — `seo-parsers` единственный новый кейс в Phase 2.
- **Риск:** добавление core-зависимости пакета на конкретные tool names. Принимаем — это согласуется с текущим дизайном.

### 4.6. MCP-инструменты пакета (5 штук)

| Tool | Source | Notes |
|---|---|---|
| `mutagen_competition` | relocated 1-1 | контракт не меняется |
| `mutagen_api` | relocated 1-1 | контракт не меняется |
| `xmlstock_yandex_serp` | new | query, lr, domain (ru/by/kz/com), device (desktop/mobile), page (0..2), groupby (10/50/100), force_refresh |
| `xmlstock_google_serp` | new | query, lr, domain (com/ru/com.ua/143), device, page, tbs (период), hl, force_refresh |
| `xmlstock_balance` | new | возвращает локальную статистику + ссылку на ЛК |

### 4.7. yandex-seo → 17 инструментов после bump

Удаляются: `mutagen_competition`, `mutagen_api`. Остаются 17:
- generic gateways: `yandex_metrika_api`, `yandex_webmaster_api`, `yandex_direct_api`
- inventory: `list_sites`, `list_counters`, `find_property`, `refresh_inventory`
- OAuth: `list_oauth_apps`, `register_oauth_app`, `delete_oauth_app`, `list_accounts`, `start_oauth_flow`, `complete_oauth_flow`, `delete_account`, `set_default_account`
- cache: `invalidate_cache`, `cache_stats`

В `invalidate_cache.inputSchema.tool` enum также чистится от `"mutagen_competition"` и `"mutagen_api"`.

## 5. File tree (target)

```
packages/seo-parsers/                                 # NEW
├── package.json                                      # name=@ohmy-seo/seo-parsers, v0.1.0, bin=mcp-seo-parsers
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── index.ts                                      # MCP server entry, 5 tool registrations
│   ├── smoke.ts                                      # mutagen + xmlstock groups, env-gated
│   ├── tools/
│   │   ├── mutagen-api.ts                            # relocated from yandex-seo
│   │   ├── mutagen-competition.ts                    # relocated from yandex-seo
│   │   ├── xmlstock-yandex-serp.ts                   # NEW
│   │   ├── xmlstock-google-serp.ts                   # NEW
│   │   └── xmlstock-balance.ts                       # NEW
│   └── lib/
│       ├── mutagen-client.ts                         # relocated
│       ├── xmlstock-client.ts                        # NEW
│       └── xmlstock-parse.ts                         # NEW

packages/yandex-seo/                                  # MODIFIED
├── package.json                                      # v0.6.0 → v0.7.0
├── src/
│   ├── index.ts                                      # -2 tool registrations, instructions updated
│   ├── smoke.ts                                      # remove mutagen group
│   ├── tools/
│   │   ├── mutagen-api.ts                            # DELETED
│   │   ├── mutagen-competition.ts                    # DELETED
│   │   └── invalidate-cache.ts                       # tool enum cleaned
│   └── lib/
│       └── mutagen-client.ts                         # DELETED

packages/core/                                        # MODIFIED (small)
└── src/cache/cache-policy.ts                         # +3 entries в CACHEABLE_TOOLS + TTL_DEFAULTS
```

## 6. Per-file content rules

Strict — каждый файл со своей ответственностью, не пересекаются.

```
packages/seo-parsers/src/index.ts:
  Contains: dotenv load, McpServer init, 5 server.registerTool() calls, validateRequiredEnv, main()
  NOT inside: HTTP client logic, XML parsing, tool business logic, DB migrations

packages/seo-parsers/src/lib/xmlstock-client.ts:
  Contains: buildXmlstockUrl(), fetchYandexSerp(), fetchGoogleSerp(), retry on 210/202 (25-s backoff, max 3)
  NOT inside: SERP normalisation, cache wrapping, async/delayed mode

packages/seo-parsers/src/lib/xmlstock-parse.ts:
  Contains: parseYandexSerpXml(xml), parseGoogleSerpXml(xml) → {results: [...], totalfound, query, lr, domain}
  NOT inside: HTTP, engine selection, input validation

packages/seo-parsers/src/tools/xmlstock-yandex-serp.ts:
  Contains: runXmlstockYandexSerp(args), withCache wrap, call client.fetchYandexSerp, return MCP content
  NOT inside: HTTP details, Google-specific params

packages/seo-parsers/src/tools/xmlstock-google-serp.ts:
  Contains: runXmlstockGoogleSerp(args), Google-specific input (tbs, hl), withCache wrap
  NOT inside: Yandex params

packages/seo-parsers/src/tools/xmlstock-balance.ts:
  Contains: runXmlstockBalance() — local stats stub + link to lk.xmlstock.com, withCache 5-min TTL
  NOT inside: hidden API discovery, scraping

packages/seo-parsers/src/smoke.ts:
  Contains: groups [mutagen, xmlstock], env-gating (SMOKE_MUTAGEN=1, SMOKE_XMLSTOCK=1), run() helper
  NOT inside: OAuth setup, tool registration
```

## 7. File plan with budgets

| File | New/Mod | Target | Hard cap | Responsibility |
|---|---|---|---|---|
| `packages/seo-parsers/package.json` | New | ~30 | 50 | NPM manifest |
| `packages/seo-parsers/tsconfig.json` | New | ~15 | 30 | TS config |
| `packages/seo-parsers/.env.example` | New | ~15 | 30 | Env template |
| `packages/seo-parsers/README.md` | New | ~80 | 150 | Install + tools list |
| `packages/seo-parsers/src/index.ts` | New | ~220 | 350 | MCP server + 5 tool reg |
| `packages/seo-parsers/src/smoke.ts` | New | ~180 | 300 | Smoke runner |
| `packages/seo-parsers/src/tools/mutagen-api.ts` | Relocated | ~30 | 60 | Generic Mutagen gateway |
| `packages/seo-parsers/src/tools/mutagen-competition.ts` | Relocated | ~25 | 60 | Mutagen competition |
| `packages/seo-parsers/src/tools/xmlstock-yandex-serp.ts` | New | ~70 | 130 | Yandex SERP tool |
| `packages/seo-parsers/src/tools/xmlstock-google-serp.ts` | New | ~70 | 130 | Google SERP tool |
| `packages/seo-parsers/src/tools/xmlstock-balance.ts` | New | ~35 | 70 | Balance summary |
| `packages/seo-parsers/src/lib/mutagen-client.ts` | Relocated | ~170 | 250 | HTTP-клиент Mutagen |
| `packages/seo-parsers/src/lib/xmlstock-client.ts` | New | ~160 | 280 | HTTP-клиент XMLStock |
| `packages/seo-parsers/src/lib/xmlstock-parse.ts` | New | ~120 | 220 | XML→JSON парсинг |
| `packages/yandex-seo/package.json` | Mod | +1/-1 | — | v0.6.0 → v0.7.0 |
| `packages/yandex-seo/src/index.ts` | Mod | -65 | — | Снять 2 reg, обновить инструкции |
| `packages/yandex-seo/src/smoke.ts` | Mod | -25 | — | Удалить runMutagen() |
| `packages/yandex-seo/src/tools/invalidate-cache.ts` | Mod | -2 | — | Убрать mutagen_* из enum |
| `packages/yandex-seo/src/tools/mutagen-api.ts` | Delete | -30 | — | — |
| `packages/yandex-seo/src/tools/mutagen-competition.ts` | Delete | -24 | — | — |
| `packages/yandex-seo/src/lib/mutagen-client.ts` | Delete | -170 | — | — |
| `packages/core/src/cache/cache-policy.ts` | Mod | +6 | — | +3 entries CACHEABLE_TOOLS + TTL |
| `~/.claude.json` | Mod | +5 | — | Add `mcp-seo-parsers` server entry |

**Итого:** ~1 200 LOC новых, ~315 LOC удалённых из yandex-seo, ~895 LOC чистый прирост.

## 8. Acceptance criteria

- [ ] `packages/seo-parsers/package.json` существует: name=`@ohmy-seo/seo-parsers`, version=`0.1.0`, dep на `@ohmy-seo/mcp-core: workspace:*`
- [ ] `pnpm --filter @ohmy-seo/seo-parsers build` → exit 0; `dist/index.js` присутствует
- [ ] `pnpm --filter @ohmy-seo/seo-parsers smoke -- --only=mutagen` зелёный при `MUTAGEN_API_KEY` + `SMOKE_MUTAGEN=1`
- [ ] `pnpm --filter @ohmy-seo/seo-parsers smoke -- --only=xmlstock` зелёный при `XMLSTOCK_USER`+`XMLSTOCK_KEY` + `SMOKE_XMLSTOCK=1`
- [ ] MCP server `mcp-seo-parsers` стартует через stdio, перечисляет 5 инструментов
- [ ] `packages/yandex-seo/package.json` версия = `0.7.0`
- [ ] yandex-seo `dist/index.js` после build перечисляет 17 инструментов (не 19)
- [ ] `grep -r "mutagen" packages/yandex-seo/src/` возвращает 0 совпадений
- [ ] `pnpm --filter @ohmy-seo/yandex-seo smoke -- --only=cache` всё ещё зелёный
- [ ] `~/.claude.json` содержит запись `mcp-seo-parsers`
- [ ] `pnpm -r build` всего монорепо → exit 0
- [ ] Пользователь подтверждает: в свежей сессии оба MCP видны и отвечают

## 9. Risks + mitigations

| Риск | Митигация |
|---|---|
| Breaking change v0.7.0 убирает 2 инструмента | CHANGELOG + minor bump. User — единственный консьюмер. |
| mcp-core bump ломает yandex-seo build | Изменение в core — расширение enum, обратно-совместимое. Проверка через `pnpm -r build`. |
| XMLStock возвращает code 210 (queue) на GET | Retry с 25-с backoff, max 3. После 3-х фейлов — ошибка с явным сообщением. |
| XMLStock-кэш TTL 24 ч устарел | `force_refresh: true` обходит кэш. |
| better-sqlite3 native binding | После `pnpm install` → `pnpm rebuild better-sqlite3` (известно из Phase 1). |
| Парсинг XML ломается при изменении формата | Fixture-snapshot из smoke. Не для Phase 2 — но сохраняем. |
| Скилл xmlstock упоминает «прямой клиент» | После Phase 2 — обновить `xmlstock/SKILL.md` (≤1 параграф). |
| Скилл mutagen упоминает `mcp-yandex-seo` | После Phase 2 — заменить на `mcp-seo-parsers` (≤5 строк). |

## 10. Skill audit findings

- **`mutagen`**: cookbook.md есть, references полные. Действие: обновить упоминания «mcp-yandex-seo» → «mcp-seo-parsers».
- **`xmlstock`**: references полные (setup, yandex-xml, yandex-live, google-xml, async-and-req-id, errors, rate-limits, integration). `cookbook.md` отсутствует, но `integration.md` функционально эквивалентен. Действие: опциональный блок «MCP usage via mcp-seo-parsers» в SKILL.md или integration.md.
- **Новые скиллы:** не требуются.

## 11. Task breakdown

15 задач, TASK-805…TASK-819. См. orchestrator.db.

## 12. Open questions

None. Все блокеры закрыты пользовательскими решениями выше.

## 13. Skills hint matrix

В контрактах каждой задачи. Базовые для всех: `mcp-server`, `nodejs`. Доменные: `xmlstock`, `mutagen`, `skill-evaluation`, `git`, `claude-code`.

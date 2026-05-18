# SPEC v2: ohmy-seo Phase 2 — `@ohmy-seo/mutagen` + `@ohmy-seo/xmlstock`

> **v2 changes from v1** (после adversarial review codex): пакет split на 2 (B), кэш-API в core рефакторится, smoke-gate против сжигания paid credits, error envelope detection до cache, fixtures обязательны в Phase 2, register-new-first migration, balance → usage_stats, кэш-ключ нормализуется, response включает fetched_at.

## 1. Goal

Вынести Mutagen из `@ohmy-seo/yandex-seo` в собственный пакет `@ohmy-seo/mutagen` (MCP-сервер `mcp-mutagen`, 2 tools) И добавить новый пакет `@ohmy-seo/xmlstock` (MCP-сервер `mcp-xmlstock`, 3 tools) для парсинга SERP Яндекса и Google через XMLStock API.

**После Phase 2:** 3 sibling-пакета (`yandex-seo` 17 tools + `mutagen` 2 tools + `xmlstock` 3 tools = 22 tools total).

## 2. Why split — обоснование решения B

- Скилл `mutagen` сам говорит: «для скрейпинга → используй XMLStock».
- Скилл `xmlstock` сам говорит: «для Wordstat/competition → используй Mutagen».
- **Они комплементарны, не родственны.** Один — про ключевые слова, второй — про парсинг выдачи.
- Шаблон 1 внешний сервис = 1 пакет повторно используется в Phase 4 (`youtube`) и Phase 5 (`threads`). Чистая граница.
- Стоимость: +1 пакет boilerplate. Окупается чистотой паттерна.

## 3. Out of scope

- Новые tools у Mutagen — переезд 1-в-1 без изменения контракта.
- XMLStock: только SERP (Yandex + Google) + usage_stats. Suggests/images/news/video — отдельная фаза.
- Async-режим XMLStock (`delayed=1` + req_id polling). MVP — hybrid GET с retry на 210.
- Phase 3 (google-seo), Phase 4 (youtube), Phase 5 (threads).
- api-gateway рефакторинг.

## 4. Architecture decisions (после codex review)

### 4.1. 🔴 mcp-core cache-policy — рефактор на универсальную регистрацию

**Проблема (codex critical):** Текущий `packages/core/src/cache/cache-policy.ts` хардкодит `MCP_YANDEX_SEO_CACHE_TTL_*` env-префикс. Новые пакеты не могут использовать свои env-переменные.

**Решение:** В core добавить API регистрации tool-cache-policy:

```ts
// packages/core/src/cache/cache-policy.ts
export interface CacheableToolConfig {
  ttlSeconds?: number;        // explicit TTL
  ttlEnvKey?: string;          // env var to read TTL from (override default)
  ttlDefaultSeconds: number;   // fallback if env unset
}

const registry = new Map<string, CacheableToolConfig>();

export function registerCacheableTool(toolName: string, cfg: CacheableToolConfig): void;
export function getToolCacheConfig(toolName: string): CacheableToolConfig | undefined;
export function isCacheable(toolName: string): boolean;
```

**Каждый пакет регистрирует свои tools на старте** (в `src/index.ts` до `server.start()`).

Существующие yandex-seo вызовы продолжают работать через **миграционный слой**: при импорте core читает старый `CACHEABLE_TOOLS` массив + `MCP_YANDEX_SEO_CACHE_TTL_*` env-переменные и регистрирует их автоматически.

**Бамп:** `@ohmy-seo/mcp-core` minor v0.1.x → v0.2.0 (расширение public API, backward-compatible).

### 4.2. 🔴 Migration order: register-new-FIRST

**Проблема (codex critical):** «User — единственный консьюмер» не митигация. Если убрать Mutagen из yandex-seo **до** регистрации нового MCP — будет окно, когда инструменты Mutagen вообще недоступны.

**Решение — атомарный switch:**
1. Создать оба новых пакета (`mutagen`, `xmlstock`)
2. Собрать их (`pnpm -r build`)
3. Зарегистрировать **новые** MCP-серверы в `~/.claude.json`
4. Попросить юзера: рестарт + проверка что `mcp-mutagen` и `mcp-xmlstock` видны
5. **Только потом** — убрать Mutagen из yandex-seo + bump v0.7.0

### 4.3. 🔴 XMLStock smoke spend-gate

**Проблема (codex critical):** XMLStock берёт деньги даже за код 210 (queue) и malformed запросы. Smoke без защиты слив­ает баланс.

**Решение:**

```bash
# В smoke runner xmlstock
if [ "$SMOKE_XMLSTOCK_SPEND_OK" != "1" ]; then
  echo "SKIP xmlstock smoke — set SMOKE_XMLSTOCK_SPEND_OK=1 to consent to paid API calls"
  exit 0
fi
```

Дополнительно:
- Максимум 2 вызова за smoke (1 Yandex + 1 Google)
- Фиксированный дешёвый запрос: `query="seo"`, `groupby=10`, `page=0`
- `force_refresh: false` — переиспользуем кэш если есть
- В начале smoke печать: `WARNING: this consumes ~2 XMLStock credits (≈0.04 RUB)`

### 4.4. ⚠️ Error envelope detection BEFORE cache write

**Проблема (codex high):** XMLStock возвращает ошибки как **HTTP 200 + XML с `<error>`-тегом**. Если кэшировать такое — забьём кэш мусором, и `force_refresh: false` будет возвращать ошибку как «успешный результат».

**Решение в `xmlstock-client.ts`:**

```ts
async function fetchSerp(...): Promise<{xml: string, ok: true} | {error: {code: number, message: string}, ok: false}> {
  const xml = await httpGet(...);
  // Parse minimal error envelope FIRST — before passing to caller
  if (xml.includes('<error code=')) {
    return {error: parseXmlstockError(xml), ok: false};
  }
  return {xml, ok: true};
}
```

В tool-wrapper'е: если `ok: false` — НЕ писать в кэш, вернуть `isError: true` в MCP response.

### 4.5. ⚠️ Parser fixtures в Phase 2 (не «когда-нибудь потом»)

**Проблема (codex high):** Парсер XML — самая хрупкая часть кода и core product surface.

**Решение:** новый шаг — захватить fixture-snapshots с реальных ответов XMLStock **до** написания parser-логики:

```
packages/xmlstock/test/fixtures/
├── yandex-serp-success.xml          # 1 запрос на «seo»
├── google-serp-success.xml          # 1 запрос на «seo»
├── error-invalid-key.xml            # эмулируем через bad XMLSTOCK_KEY
├── error-queue-210.xml              # эмулируем (если попадётся) или mock
└── missing-favicon.xml              # snippet/title есть, favicon нет
```

Парсер тестируется на fixtures через вспомогательный `pnpm test:parse` скрипт.

### 4.6. ⚠️ Cache key normalization

**Проблема (codex medium):** Без нормализации `device=desktop` и omitted device → 2 разные cache-entries для того же запроса.

**Решение:** В каждом tool-wrapper'е нормализуем args до canonical form:

```ts
function canonicalArgs(args) {
  return {
    engine: args.engine,       // 'yandex' | 'google'
    query: args.query.trim().toLowerCase(),
    lr: args.lr ?? null,
    domain: args.domain ?? 'ru',
    device: args.device ?? 'desktop',
    page: args.page ?? 0,
    groupby: args.groupby ?? 10,
    tbs: args.tbs ?? null,
    hl: args.hl ?? null,
  };
}
// cache-key = sha256(JSON.stringify(canonicalArgs(args)))
```

**Никогда не включать `XMLSTOCK_USER`/`XMLSTOCK_KEY` в cache-key.**

### 4.7. ⚠️ Response shape: fetched_at + cache_age

**Проблема (codex medium):** Агенты забывают про свежесть; нужна явная метаданные.

**Решение:** SERP-ответ:

```json
{
  "engine": "yandex",
  "query": "seo",
  "results": [...],
  "totalfound": 12345,
  "fetched_at": "2026-05-18T15:30:00Z",
  "cache_age_seconds": 0,
  "expires_at": "2026-05-19T15:30:00Z",
  "cached": false
}
```

При cache hit: `cached: true`, `cache_age_seconds: <фактический>`.

### 4.8. ⚠️ xmlstock_balance → xmlstock_usage_stats

**Проблема (codex high):** Tool с именем «balance», возвращающий «нет API для баланса» — вводит в заблуждение.

**Решение:** Переименовать в `xmlstock_usage_stats`. Возвращает:
- Локальный счётчик: сколько вызовов сделано через MCP с момента старта (хранится в БД пакета)
- Распределение по engine (Yandex / Google)
- Ссылка на ЛК: `https://xmlstock.com/lk/`
- Явная пометка: «Для актуального баланса — открой ЛК»

### 4.9. ⚠️ Google paging explicit

**Проблема (codex medium):** XMLStock Google: 10 результатов/страница, `groupby` не работает.

**Решение:** В `xmlstock_google_serp` tool schema:
- `groupby` параметр **отсутствует** (vs Yandex, где есть 10/50/100)
- `page` 0..9 (Google максимум 100 результатов = 10 страниц)
- В description tool явно: «Google: 10 results/page, max 10 pages (100 total)»

### 4.10. ⚠️ Параллельный task graph

**Проблема (codex high):** v1 граф был последовательным. Можно дешевле параллелить.

**Новый граф:**
- **Wave 1** (параллельно): skill audit + bootstrap mutagen pkg + bootstrap xmlstock pkg + cache refactor in core
- **Wave 2** (параллельно): mutagen relocate + xmlstock fixtures + xmlstock client (после Wave 1)
- **Wave 3**: xmlstock parser (после Wave 2 fixtures+client) + mutagen index/smoke (после Wave 2 relocate)
- **Wave 4**: xmlstock tools (после parser) + xmlstock index/smoke
- **Wave 5**: full build + register both MCPs в ~/.claude.json + skill updates
- **Wave 6** (user gate): user verifies both MCPs visible
- **Wave 7**: strip Mutagen from yandex-seo + bump v0.7.0
- **Wave 8** (user gate): final integration smoke

Критический путь: ~8 серий по 1 задаче ≈ 8 tasks длиной. Остальные параллельны.

## 5. Package layout (target)

```
packages/
├── core/                                                  # MOD: cache-policy.ts refactor + v bump
│   └── src/cache/cache-policy.ts                          # +registerCacheableTool API
├── yandex-seo/                                            # MOD: v0.7.0, -2 tools, 17 left
│   └── (Mutagen removed)
├── mutagen/                                               # NEW
│   ├── package.json                                       # name=@ohmy-seo/mutagen, v0.1.0
│   ├── tsconfig.json
│   ├── .env.example                                       # MCP_MUTAGEN_MASTER_KEY, MUTAGEN_API_KEY, TTL
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                                       # 2 tool registrations
│   │   ├── smoke.ts                                       # mutagen group (uses MUTAGEN_API_KEY)
│   │   ├── tools/
│   │   │   ├── mutagen-api.ts                             # relocated
│   │   │   └── mutagen-competition.ts                     # relocated
│   │   └── lib/
│   │       └── mutagen-client.ts                          # relocated
│   └── data/state.db                                       # gitignored
└── xmlstock/                                              # NEW
    ├── package.json                                       # name=@ohmy-seo/xmlstock, v0.1.0
    ├── tsconfig.json
    ├── .env.example
    ├── README.md
    ├── src/
    │   ├── index.ts                                       # 3 tool registrations
    │   ├── smoke.ts                                       # xmlstock group with SPEND-OK gate
    │   ├── tools/
    │   │   ├── xmlstock-yandex-serp.ts                    # NEW
    │   │   ├── xmlstock-google-serp.ts                    # NEW
    │   │   └── xmlstock-usage-stats.ts                    # NEW (renamed from balance)
    │   └── lib/
    │       ├── xmlstock-client.ts                         # HTTP + retry + error envelope
    │       ├── xmlstock-parse.ts                          # XML→JSON, tested on fixtures
    │       └── usage-counter.ts                           # local counter in pkg DB
    ├── test/
    │   └── fixtures/
    │       ├── yandex-serp-success.xml
    │       ├── google-serp-success.xml
    │       ├── error-invalid-key.xml
    │       └── missing-favicon.xml
    └── data/state.db                                       # gitignored
```

## 6. MCP tools — финальный список

### `mcp-mutagen` (2 tools)

| Tool | Source | Args |
|---|---|---|
| `mutagen_competition` | relocated 1-1 | (unchanged contract) |
| `mutagen_api` | relocated 1-1 | (unchanged contract) |

### `mcp-xmlstock` (3 tools)

| Tool | Args | Cache TTL |
|---|---|---|
| `xmlstock_yandex_serp` | query, lr?, domain (ru/by/kz/com)?, device (desktop/mobile)?, page (0..2)?, groupby (10/50/100)?, force_refresh? | 24h (`MCP_XMLSTOCK_CACHE_TTL_SERP`, default 86400) |
| `xmlstock_google_serp` | query, lr?, domain (com/ru/com.ua/143)?, device?, page (0..9)?, tbs?, hl?, force_refresh? | 24h |
| `xmlstock_usage_stats` | (no args) | 5m (`MCP_XMLSTOCK_CACHE_TTL_STATS`, default 300) |

## 7. Acceptance criteria

### Package: `@ohmy-seo/mutagen`
- [ ] `packages/mutagen/package.json` существует: name=`@ohmy-seo/mutagen`, version=`0.1.0`
- [ ] `pnpm --filter @ohmy-seo/mutagen build` → exit 0; `dist/index.js` присутствует
- [ ] `pnpm --filter @ohmy-seo/mutagen smoke` зелёный при `MUTAGEN_API_KEY` + `SMOKE_MUTAGEN=1`
- [ ] 2 tools зарегистрированы

### Package: `@ohmy-seo/xmlstock`
- [ ] `packages/xmlstock/package.json` существует: name=`@ohmy-seo/xmlstock`, version=`0.1.0`
- [ ] `pnpm --filter @ohmy-seo/xmlstock build` → exit 0
- [ ] Parser проходит тесты на всех 4 fixtures
- [ ] `pnpm --filter @ohmy-seo/xmlstock smoke -- --only=cache` зелёный (без paid calls)
- [ ] `pnpm --filter @ohmy-seo/xmlstock smoke -- --only=xmlstock` зелёный при `SMOKE_XMLSTOCK_SPEND_OK=1` + ключи (max 2 paid calls, фикс. дешёвый запрос)
- [ ] Error envelope detection: tool возвращает `isError: true` для XMLStock error response (НЕ кэширует)
- [ ] Response включает `fetched_at`, `cache_age_seconds`, `expires_at`, `cached`

### `mcp-core` cache refactor
- [ ] `registerCacheableTool(name, cfg)` API экспортируется из `@ohmy-seo/mcp-core`
- [ ] Существующие yandex-seo cache-tests проходят без изменений (backward-compat миграция работает)
- [ ] `@ohmy-seo/mcp-core` version bumped to `0.2.0`

### Migration order
- [ ] Оба новых MCP-сервера зарегистрированы в `~/.claude.json` **до** удаления Mutagen из yandex-seo
- [ ] Пользователь подтверждает, что в свежей сессии видны `mcp-mutagen` и `mcp-xmlstock` ДО следующего шага
- [ ] Только после user-OK — удаление Mutagen из yandex-seo + bump v0.7.0
- [ ] После всего: `grep -r "mutagen" packages/yandex-seo/src/` → 0
- [ ] yandex-seo dist registers exactly 17 tools

### Final
- [ ] `pnpm -r build` → exit 0
- [ ] `pnpm --filter @ohmy-seo/yandex-seo smoke -- --only=cache` зелёный
- [ ] `~/.claude.json` содержит `mcp-mutagen` + `mcp-xmlstock`
- [ ] Финальный user smoke: 17 + 2 + 3 = 22 tools видны в 3 MCP-серверах

## 8. Skill updates

- `mutagen` skill: упоминания `mcp-yandex-seo` → `mcp-mutagen`
- `xmlstock` skill: добавить блок «Using via mcp-xmlstock» (1 параграф)

## 9. Open questions

None. Все decision points закрыты v2.

## 10. Task list (waves)

См. `task list` в orchestrator.db. Новые ID начинаются с TASK-901.

Wave 1 (параллельно): TASK-901 skill audit, TASK-902 core cache refactor, TASK-903 bootstrap mutagen pkg, TASK-904 bootstrap xmlstock pkg

Wave 2 (параллельно): TASK-905 relocate mutagen files, TASK-906 capture xmlstock fixtures, TASK-907 xmlstock client

Wave 3 (параллельно): TASK-908 xmlstock parser (deps: 906+907), TASK-909 mutagen index+smoke (deps: 905)

Wave 4: TASK-910 xmlstock 3 tools (deps: 908), TASK-911 xmlstock index+smoke (deps: 910)

Wave 5 (параллельно): TASK-912 full pnpm -r build (deps: 909+911), TASK-913 register both MCPs in ~/.claude.json (deps: 912), TASK-914 skill updates (deps: 901+912)

Wave 6 (USER GATE): TASK-915 user verifies new MCPs visible (deps: 913)

Wave 7: TASK-916 strip Mutagen from yandex-seo (deps: 915), TASK-917 bump yandex-seo v0.7.0 (deps: 916), TASK-918 verify yandex-seo build (deps: 917)

Wave 8 (USER GATE): TASK-919 final integration smoke (deps: 918+914)

**Total: 19 tasks** (vs v1 — 15). +4 за разнесение пакетов и safety reorder.

## 11. Risks + mitigations (v2)

| Риск | Митигация |
|---|---|
| core cache refactor ломает yandex-seo | Backward-compat миграция: старые CACHEABLE_TOOLS + env-keys читаются и регистрируются автоматически. Smoke yandex-seo verifies. |
| Fixtures устаревают через 6 мес | Fixtures pinned, парсер тестируется на них. При live drift — обновляем fixtures. |
| SPEND_OK=1 случайно установлен в CI | CI отсутствует. Локальный smoke — explicit env. |
| 2 пакета вместо 1 — больше boilerplate | Принимаем. Чистая граница окупается. |
| Migration window: яндекс-сео-without-mutagen ≠ ready | Snimaem только после user OK что новые MCP видны. |

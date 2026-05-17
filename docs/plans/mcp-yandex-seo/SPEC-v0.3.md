# SPEC: mcp-yandex-seo v0.3 — Inventory Cache (24h TTL, stale-while-revalidate)

Дата: 2026-05-17. Базируется на ROADMAP.md и SPEC-v0.2.md.
Предыдущая версия: v0.2 (15 tools, multi-account OAuth, encrypted SQLite, 4 accounts уже подключено).

## Goal

Перевести inventory (списки Webmaster-сайтов и Metrika-счётчиков) в общую проектную SQLite-БД. MCP сам наполняет inventory через Yandex API, кеширует на 24 часа со стратегией stale-while-revalidate, экспонирует 4 новых tool (`list_sites`, `list_counters`, `find_property`, `refresh_inventory`). Все доменные tools (webmaster_*, metrika_*) получают опц. `site` параметр, резолвящийся в `host_id` / `counter_id` через property-resolver. Артефакты v0.2-rescue (`data/inventory.json`, `scripts/fetch-inventory.mjs`) удаляются.

## Non-goals (v0.3)

- Query result cache (Wordstat/Mutagen/top_queries TTL) — v0.4
- OS keychain — v0.5
- Direct clients inventory (`list_direct_clients`) — отложено до появления аккаунта со scope `direct:api`
- Fuzzy/typo search — только substring + score
- Pagination >100 items — v0.4 при необходимости
- Per-kind разные TTL — единый TTL в v0.3
- CLI/admin вне MCP — только tools
- Cross-account dedup — возвращаем оба
- Backwards-compat для прямого host_id/counter_id СОХРАНЯЕТСЯ
- Webhook / push-уведомления — только lazy pull

## Acceptance criteria

- [ ] `npm run build` + `tsc --noEmit` зелёные
- [ ] Миграция v2 применяется идемпотентно на существующей `data/state.db` без потери данных в oauth_apps/accounts
- [ ] PRAGMA user_version = 2 после миграции; повторный старт не пытается её применить
- [ ] 19 tools зарегистрированы (8 oauth + 7 доменных с опц. site + 4 inventory)
- [ ] `refresh_inventory()` без аргументов рефрешит все accounts × все применимые kinds; с `account` — один; с `kind` — один. Возвращает per-pair отчёт `{account_label, kind, fetched, inserted, updated, removed, duration_ms, error?}`
- [ ] `list_sites()` без аргументов — все аккаунты с scope webmaster:hostinfo; sync-refresh при холодном кеше; stale+async-refresh при возрасте >TTL
- [ ] `list_counters()` — аналогично для Metrika
- [ ] `find_property({query, kind?})` — case-insensitive substring, score 100=exact / 80=starts-with / 50=contains; sort desc; top 25
- [ ] `webmaster_site_summary({site: "example.com"})` без host_id → property-resolver резолвит уникального → tool работает. Ambiguous → isError с кандидатами
- [ ] Если переданы оба host_id и site — приоритет host_id, site игнорируется без ошибки
- [ ] Concurrent `refresh_inventory({account:"X", kind:"sites"})` × 2 → один HTTP-запрос (mutex per `${accountId}:${kind}`)
- [ ] При недоступности Yandex API во время refresh — данные в inv_* СОХРАНЯЮТСЯ; обновляется только `inv_refresh_meta.last_error` + `last_refresh_attempt_at`
- [ ] Удалены файлы: `data/inventory.json`, `scripts/fetch-inventory.mjs`
- [ ] `.env.example` содержит `MCP_YANDEX_SEO_CACHE_TTL_HOURS=24`
- [ ] Невалидный TTL (не число / ≤0) → fallback 24h + warning в stderr, не fatal
- [ ] README v0.3 содержит секцию "Inventory" с описанием 4 tools + stale-while-revalidate
- [ ] Audit grep: `data/inventory.json` и `scripts/fetch-inventory.mjs` не упоминаются нигде

## Architecture decisions

- **Inventory — отдельная под-domain.** accounts хранит auth-state, inv_* хранит produced-from-API. FK с ON DELETE CASCADE.
- **TTL единый.** Per-kind можно ввести позже при реальной потребности.
- **Stale-while-revalidate в `cache-policy.ts`.** Tool-обёртки не разбираются с возрастом.
- **Mutex по composite key `${accountId}:${kind}`.** Не глобально и не per-account.
- **Async refresh — fire-and-forget Promise с `.catch` в stderr.** В MCP-tool не передаётся.
- **Property resolver — pure module без I/O.** Принимает arrays, возвращает scored list.
- **Доменные tools: site OR host_id.** host_id остаётся escape hatch.
- **`inv_refresh_meta` — отдельная таблица.** Meta per-(account_id, kind), не per-row.
- **`src/index.ts` cap 380 → 500.** Регистрация 4 tools + threading site param раздувает. Альтернатива — выделить registration-модуль; отклонена из-за лишнего indirection.
- **Yandex API pagination не реализуем в v0.3.** 100 hosts/counters default. Warning при truncation; пагинация — v0.4 если понадобится.
- **Никакого retry/backoff в refresher.** Один request; broker сам делает refresh-on-401.

## Data model — migration v2

```sql
-- Applied when PRAGMA user_version < 2
CREATE TABLE IF NOT EXISTS inv_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  host_id TEXT NOT NULL,
  ascii_host_url TEXT NOT NULL,
  unicode_host_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  main_mirror INTEGER NOT NULL DEFAULT 0,
  indexed_pages INTEGER,
  fetched_at INTEGER NOT NULL,
  UNIQUE (account_id, host_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_sites_account ON inv_sites(account_id);
CREATE INDEX IF NOT EXISTS idx_inv_sites_ascii   ON inv_sites(ascii_host_url);

CREATE TABLE IF NOT EXISTS inv_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  counter_id TEXT NOT NULL,
  name TEXT,
  site TEXT,
  status TEXT,
  permission TEXT,
  fetched_at INTEGER NOT NULL,
  UNIQUE (account_id, counter_id)
);
CREATE INDEX IF NOT EXISTS idx_inv_counters_account ON inv_counters(account_id);
CREATE INDEX IF NOT EXISTS idx_inv_counters_name    ON inv_counters(name);

CREATE TABLE IF NOT EXISTS inv_refresh_meta (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sites','counters')),
  last_refresh_success_at INTEGER,
  last_refresh_attempt_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (account_id, kind)
);

PRAGMA user_version = 2;
```

Идемпотентность через `IF NOT EXISTS` + проверку `user_version < 2`.

## File plan (with budgets + responsibility)

| File | New/Modified | Target | Hard cap | Responsibility |
|---|---|---|---|---|
| `src/lib/db/migrations.ts` | Modified | +30 | 200 | Apply ordered migrations including v2 inventory schema |
| `src/lib/db/inventory-repo.ts` | New | ~180 | 250 | CRUD over inv_sites/inv_counters/inv_refresh_meta |
| `src/lib/inventory/refresher.ts` | New | ~150 | 220 | Fetch sites/counters from Yandex API per account, persist via repo |
| `src/lib/inventory/cache-policy.ts` | New | ~80 | 150 | Decide sync/return-stale+async based on TTL, manage mutex |
| `src/lib/property-resolver.ts` | New | ~120 | 200 | Score-based substring search, AmbiguousSiteError handling |
| `src/lib/webmaster-client.ts` | Modified | +25 | 250 | Add `getHostsList({accessToken, webmasterUserId})` |
| `src/lib/metrika-client.ts` | Modified | +25 | 250 | Add `getCountersList({accessToken})` |
| `src/tools/list-sites.ts` | New | ~50 | 100 | MCP wrapper around cache-policy for sites |
| `src/tools/list-counters.ts` | New | ~50 | 100 | MCP wrapper around cache-policy for counters |
| `src/tools/find-property.ts` | New | ~60 | 120 | MCP wrapper around property-resolver, gathers cross-account inventory |
| `src/tools/refresh-inventory.ts` | New | ~70 | 140 | MCP wrapper triggering explicit refresh |
| `src/tools/webmaster-*.ts` (×3) | Modified | +12 each | 150 | Resolve optional `site` to host_id before client call |
| `src/tools/metrika-*.ts` (×2) | Modified | +12 each | 150 | Resolve optional `site` to counter_id before client call |
| `src/index.ts` | Modified | +70 | 500 | Register 4 new tools + thread `site` param into 5 existing |
| `src/lib/errors.ts` | Modified | +15 | 350 | Add AmbiguousSiteError class |
| `.env.example` | Modified | +2 | — | Document MCP_YANDEX_SEO_CACHE_TTL_HOURS=24 |
| `README.md` | Modified | +60 | 500 | Document 4 new tools + site param + stale-while-revalidate |
| `data/inventory.json` | **Deleted** | — | — | Replaced by inv_* tables |
| `scripts/fetch-inventory.mjs` | **Deleted** | — | — | Replaced by refresh_inventory tool |
| `src/smoke.ts` | Modified | +20 | 350 | Add inventory smoke (refresh + list assertions) |
| `package.json` | Modified | version 0.3.0 | — | — |

**Forecast delta:** ~650 LOC new + ~150 LOC modified, ~100 LOC removed. Repo total after v0.3 ≈ 3250 LOC.

## Tools input schemas (pseudocode)

```ts
list_sites({account?: string})
list_counters({account?: string})
find_property({query: string, kind?: "site" | "counter"})
refresh_inventory({account?: string, kind?: "sites" | "counters"})
```

Все: `{readOnlyHint: true, openWorldHint: true, idempotentHint: false}`. Description ≥150 chars.

Доменные tools получают `site: z.string().min(1).optional()`. `host_id` / `counter_id` становятся optional (но at-least-one validation в handler).

## Refresh semantics + mutex specification

```
mutexes = Map<string, Promise<void>>()
TTL_SEC = validateTtl(env.MCP_YANDEX_SEO_CACHE_TTL_HOURS) * 3600  // fallback 24*3600

function key(accountId, kind) = `${accountId}:${kind}`

async getSitesWithPolicy(accountId):
  meta = repo.getRefreshMeta(accountId, 'sites')
  rows = repo.listSites({account_id: accountId})

  if meta == null OR rows.length == 0:
    await acquireAndRun(accountId, 'sites', refresher.refreshSitesForAccount)
    return repo.listSites({account_id: accountId})

  if meta.last_refresh_success_at == null OR (now - meta.last_refresh_success_at) > TTL_SEC:
    triggerAsyncRefresh(accountId, 'sites')
    return rows  // stale

  return rows

async acquireAndRun(accountId, kind, fn):
  k = key(accountId, kind)
  if mutexes.has(k): return mutexes.get(k)
  promise = fn(accountId).finally(() => mutexes.delete(k))
  mutexes.set(k, promise)
  return promise

triggerAsyncRefresh(accountId, kind):
  acquireAndRun(accountId, kind, refresher[kind])
    .catch(err => console.error(`async refresh failed acc=${accountId} kind=${kind}: ${err.message}`))
```

## Property resolver algorithm

```ts
scoreCandidate(queryLower, valueLower):
  if !valueLower.includes(queryLower): return 0
  if valueLower === queryLower: return 100
  if valueLower.startsWith(queryLower): return 80
  return 50

findProperty({query, kind, sites, counters}):
  q = query.toLowerCase().trim()
  if q.length === 0: return []
  results = []
  if !kind || kind === 'site':
    for s of sites:
      score = max(scoreCandidate(q, s.ascii_host_url.lower), scoreCandidate(q, s.unicode_host_url?.lower ?? ''))
      if score > 0: results.push({kind:'site', account_label, host_id, display, score, indexed_pages})
  if !kind || kind === 'counter':
    for c of counters:
      score = max(scoreCandidate(q, c.name?.lower ?? ''), scoreCandidate(q, c.site?.lower ?? ''), scoreCandidate(q, c.counter_id))
      if score > 0: results.push({kind:'counter', account_label, counter_id, display, score})
  return results.sort((a,b)=>b.score-a.score).slice(0, 25)

resolveSite(query, accountFilter?) → host_id:
  matches = findProperty({query, kind:'site', sites: repo.listSites({account_filter}), counters: []})
  if matches.length === 0: throw "No site matching"
  if matches.length === 1 || matches[0].score > matches[1].score: return matches[0].host_id
  throw new AmbiguousSiteError(query, matches.filter(m => m.score === matches[0].score))
```

## Risks & mitigation

1. **Stale-data UX confusion** — agent видит fetched_at 23h59m old.  
   *Mitigation:* `list_*` ответ включает per-row `fetched_at` + per-account `cache_age_seconds`. README документирует.

2. **Refresh during Yandex outage drops inventory** — наивный DELETE-then-INSERT wipes cache.  
   *Mitigation:* upsert + compute-delta-removal только при УСПЕШНОМ fetch. На HTTP error → no writes to inv_*, только `inv_refresh_meta.last_error`.

3. **Fuzzy false-positives через substring** — `"ru"` матчит каждый .ru.  
   *Mitigation:* документировано в description. Score boosts exact/prefix. AmbiguousSiteError форсит explicit disambiguation.

4. **Large inventories >100 items per account** — pagination не реализована.  
   *Mitigation:* при `length === 100` log warning. Pagination → v0.4.

5. **Race с set_default_account во время list_sites** — is_default может стать неконсистентным.  
   *Mitigation:* `is_default` НЕ кешируется в inv_*; читается fresh из accounts каждый раз.

6. **Migration на existing DB** — v0.2 state.db уже user_version=1.  
   *Mitigation:* startup-миграция применяет v1→v2 идемпотентно. Smoke verifies on copy перед production-DB.

7. **Невалидный TTL env** — divide-by-zero / NaN.  
   *Mitigation:* strict parse, fallback 24h + stderr warn.

8. **Token broker refresh во время inventory async-refresh** — оба используют broker mutex.  
   *Mitigation:* broker mutex per-accountId, inventory mutex per-(accountId,kind). Не пересекаются.

## Decomposition into atomic tasks

8 tasks. Critical path: **301 → 302 → 303 → (304 ‖ 305) → 306 → 307 → 308**

| Task | Title | Risk |
|---|---|---|
| TASK-301 | Migration v2 + inventory-repo | medium |
| TASK-302 | Webmaster + Metrika list-fetchers | low |
| TASK-303 | Refresher + cache-policy with mutex | high |
| TASK-304 | Property-resolver (pure module) | low |
| TASK-305 | Inventory MCP tools (4 new) + register | medium |
| TASK-306 | Wire `site` param into 5 domain tools | medium |
| TASK-307 | Cleanup + docs + smoke + version bump | low |
| TASK-308 | Final acceptance review | low |

## Out of scope (повтор для ясности)

- Query result cache — v0.4
- OS keychain — v0.5
- Direct clients inventory — postponed
- Fuzzy/typo search — never
- Pagination >100 — v0.4 при необходимости
- HTTP/SSE transport — never
- `oauth_events` audit log — v0.5
- Per-kind differential TTLs — возможно v0.4

## Open questions (implementation-time)

1. Webmaster `/v4/user/{user-id}/hosts/` response shape — assumed `{hosts: [{host_id, ascii_host_url, unicode_host_url, verification, main_mirror?}]}`. To confirm в TASK-302.
2. Metrika `/management/v1/counters` permission field — может быть own/view/edit/public_stats. Map exactly в TASK-302.
3. `indexed_pages` per host — Webmaster list endpoint может его не возвращать. Если нет — leave NULL, попозже opportunistic update через getSiteSummary (вне scope v0.3).

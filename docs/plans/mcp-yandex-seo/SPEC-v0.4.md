# SPEC: mcp-yandex-seo v0.4 — Query Result Cache + Smart Routing

Дата: 2026-05-17. Базируется на ROADMAP.md и SPEC-v0.3.md.
Предыдущая версия: v0.3 (19 tools, multi-account OAuth, inventory cache 24h SWR, 4 accounts).

## Goal

Per-tool TTL query result cache для 7 доменных tools. Кешируем по sha256-хешу нормализованных аргументов (включая `account_id`, не label). Read-through стратегия (без stale-while-revalidate). Каждый кешируемый tool получает опц. `force_refresh: boolean`. Два новых meta-tool: `invalidate_cache` и `cache_stats`. Smart routing: при явном `host_id`, который есть в `inv_sites` ровно одного account_id — этот аккаунт выбирается автоматически.

## Non-goals (v0.4)

- LRU eviction / auto-cleanup по размеру — отложено
- Cache warmup на старте — не нужно
- Per-row шифрование response_json — response не содержит секретов
- Distributed cache / Redis — never
- Stale-while-revalidate для query cache — намеренно отказались
- OS keychain master-key — v0.5
- Кеширование oauth-management / inventory tools — у них свой кеш или нет смысла
- Pagination >100 inventory items — отложено
- Wordstat fix (нужен Direct OAuth app) — отдельный track; инфраструктура v0.4 поддерживает Wordstat кеш заранее

## Acceptance criteria

- [ ] `npm run build` + `tsc --noEmit` зелёные
- [ ] Миграция v3 идемпотентна; PRAGMA user_version=3; повторный старт не пытается её применить
- [ ] Сохраняются все данные v0.3 (oauth_apps, accounts, inv_*) после миграции
- [ ] 21 tool зарегистрирован (8 oauth + 7 доменных с опц. force_refresh + 4 inventory + 2 cache)
- [ ] 7 кешируемых tools при втором вызове с теми же args возвращают результат БЕЗ HTTP; `hit_count` увеличивается; `last_hit_at` обновляется
- [ ] Cache key инвариант: разные label у одного account_id дают одинаковый хеш
- [ ] Cache key инвариант: переставленные ключи args дают одинаковый хеш (canonical JSON sort)
- [ ] `force_refresh: true` пропускает cache read, выполняет tool, перезаписывает entry (hit_count сбрасывается)
- [ ] Expired entry → miss → tool выполняется, entry перезаписывается
- [ ] Per-tool TTL правильный: wordstat=7d, mutagen=30d, top_queries/search_phrases/indexing_issues=1h, site_summary/traffic_summary=6h
- [ ] Env override `MCP_YANDEX_SEO_CACHE_TTL_<TOOLNAME>=<seconds>` для каждого работает; невалидное → fallback default + stderr warning
- [ ] При throw в tool — НИКАКОЙ записи в query_cache (кешируем только успехи)
- [ ] `invalidate_cache({})` — wipe всё
- [ ] `invalidate_cache({tool:"X"})` — только этого tool; `{account:"label"}` — только этого account; `{older_than_hours:24}` — старше 24ч; фильтры комбинируются AND
- [ ] `cache_stats()` возвращает total_entries, db_size_bytes, top_tools (top-10), recent_24h
- [ ] Smart routing: явный host_id уникальный в inv_sites → account резолвится автоматически; explicit account всегда выигрывает
- [ ] `.env.example` содержит 7 строк TTL override
- [ ] README v0.4 содержит секцию "Query Result Cache" с TTL-таблицей, force_refresh, описанием 2 новых tools
- [ ] `package.json` version → 0.4.0
- [ ] `src/smoke.ts` содержит cache-smoke (2× call → hit → force_refresh → entry rewritten)

## Architecture decisions

- **Cache-aware декоратор `withCache(toolName, accountId, args, fn, options)`.** Tool-обёртки оборачивают финальный call. Read-through, без mutex (concurrent miss = двойной API call принимаем; mutex добавим в v0.5 если станет проблемой).
- **Cache key = sha256(canonical JSON of `{tool, account_id, ...other_args}`).** account_id (не label). Canonicalization: рекурсивный Object.keys sort. force_refresh НЕ участвует в hash. undefined opущены.
- **TTL hardcoded defaults + env override.** `MCP_YANDEX_SEO_CACHE_TTL_<UPPER_SNAKE>=<seconds>`. Lazy-memoized.
- **mutagen_competition: account_id=NULL** (single API key). Hash включает `tool: 'mutagen_competition'` — collision с другими исключён.
- **Smart routing helper `resolveAccountByHostId(hostId)` в property-resolver.** Ищет уникального owner в inv_sites; иначе null. Priority: explicit account → smart-route → default.
- **Cache cleanup НЕ автоматический.** `cache_stats` показывает размер; пользователь сам зовёт `invalidate_cache`.
- **`src/index.ts` cap 500 → 600** (добавление 2 tools + force_refresh в 7 раздувает).
- **response_json как TEXT JSON.stringify, без compression.** Wordstat <50KB, top_queries при limit=500 <200KB.
- **hit_count сбрасывается на UPSERT.** force_refresh — это de-facto новая entry.
- **Никакого retry в withCache.** Broker уже делает refresh-on-401.

## Data model — migration v3

```sql
CREATE TABLE IF NOT EXISTS query_cache (
  args_hash TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,  -- NULL для mutagen
  args_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_query_cache_tool    ON query_cache(tool_name);
CREATE INDEX IF NOT EXISTS idx_query_cache_account ON query_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_query_cache_fetched ON query_cache(fetched_at);

PRAGMA user_version = 3;
```

## File plan

| File | New/Modified | Target | Hard cap | Responsibility |
|---|---|---|---|---|
| `src/lib/db/migrations.ts` | Modified | +30 | 200 | Apply migration v3 |
| `src/lib/cache/query-cache-repo.ts` | New | ~150 | 220 | CRUD over query_cache |
| `src/lib/cache/cache-keys.ts` | New | ~80 | 130 | canonical JSON + sha256 hashing |
| `src/lib/cache/cache-policy.ts` | New | ~120 | 200 | withCache() + getTtlForTool |
| `src/lib/cache/cache-stats.ts` | New | ~80 | 150 | Aggregate stats |
| `src/lib/property-resolver.ts` | Modified | +25 | 220 | + resolveAccountByHostId |
| `src/tools/invalidate-cache.ts` | New | ~50 | 100 | MCP wrapper |
| `src/tools/cache-stats.ts` | New | ~50 | 100 | MCP wrapper |
| `src/tools/wordstat-keywords.ts` | Modified | +12 | 80 | wrap in withCache |
| `src/tools/mutagen-competition.ts` | Modified | +12 | 80 | wrap (accountId=null) |
| `src/tools/webmaster-*.ts` (×3) | Modified | +14 each | 100 | wrap + smart routing |
| `src/tools/metrika-*.ts` (×2) | Modified | +14 each | 100 | wrap |
| `src/index.ts` | Modified | +60 | **600** | register 2 + force_refresh × 7 |
| `.env.example` | Modified | +12 | — | 7 TTL overrides |
| `README.md` | Modified | +90 | — | Cache section |
| `src/smoke.ts` | Modified | +30 | 400 | cache-smoke group |
| `package.json` | Modified | 0.4.0 | — | — |

**Total v0.4 delta:** ~530 new + ~210 modified LOC. Repo total ≈ 3800 LOC.

## Tool input schemas

```ts
invalidate_cache({
  tool?: enum of 7 cacheable tool names,
  account?: account_label_string,
  older_than_hours?: positive_integer,
})
// description ≥150 chars about filters + AND combine + use case

cache_stats({})
// description ≥150 chars about returned aggregates

// 7 cacheable tools get extra field:
force_refresh: z.boolean().optional().default(false).describe(
  "If true, bypass cache read and re-fetch fresh data, overwriting any cached entry."
)
```

## Cache key algorithm

```ts
function canonicalStringify(value): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']'
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}'
}

function computeArgsHash(toolName, accountId, args): string {
  const { force_refresh, ...rest } = args
  const payload = { tool: toolName, account_id: accountId ?? null, args: rest }
  return sha256_hex(canonicalStringify(payload))
}
```

## withCache wrapper

```ts
async function withCache<T>({toolName, accountId, args, forceRefresh}, fn): Promise<T> {
  const hash = computeArgsHash(toolName, accountId, args)
  const now = Math.floor(Date.now() / 1000)

  if (!forceRefresh) {
    const entry = repo.getEntry(hash)
    if (entry && entry.expires_at > now) {
      repo.incrementHit(hash, now)
      return JSON.parse(entry.response_json) as T
    }
  }
  const result = await fn()  // throws → no cache write
  const ttl = getTtlForTool(toolName)
  repo.putEntry({
    args_hash: hash,
    tool_name: toolName,
    account_id: accountId,
    args_json: canonicalStringify({tool, account_id, args}),
    response_json: JSON.stringify(result),
    fetched_at: now,
    expires_at: now + ttl,
  })
  return result
}
```

## TTL configuration

```ts
const TTL_DEFAULTS = {
  wordstat_keywords:         7 * 24 * 3600,    // 604800
  mutagen_competition:      30 * 24 * 3600,    // 2592000
  webmaster_top_queries:         1 * 3600,     // 3600
  metrika_search_phrases:        1 * 3600,     // 3600
  webmaster_indexing_issues:     1 * 3600,     // 3600
  webmaster_site_summary:        6 * 3600,     // 21600
  metrika_traffic_summary:       6 * 3600,     // 21600
}
```

Env override: `MCP_YANDEX_SEO_CACHE_TTL_<UPPER_SNAKE>=<seconds>`. Lazy-memoized. Invalid → warn + default.

## Risks & mitigation

1. **Cache poisoning** — stale Yandex response застрянет на TTL.  
   *Mitigation:* `force_refresh` + `invalidate_cache` tools. README.
2. **Неконтролируемый рост DB** при heavy usage.  
   *Mitigation:* `cache_stats` показывает размер. README рекомендует periodic invalidate. LRU — v0.5.
3. **Concurrent miss → double API call.**  
   *Mitigation:* accepted в v0.4. Mutex — v0.5 при сигнале.
4. **Migration v3 повреждает DB.**  
   *Mitigation:* IF NOT EXISTS + transaction + version check.
5. **TTL env override typos** — silent fallback.  
   *Mitigation:* .env.example + warning при невалидном значении.
6. **Smart routing breaks ambiguity errors users привыкли видеть.**  
   *Mitigation:* explicit account всегда wins. Backwards-compat.

## Decomposition

8 tasks. Critical path: **402 → 403 → 404 → 405 → 406 → 407 → 408 → 409**

| Task | Title | Risk |
|---|---|---|
| TASK-402 | Migration v3 + query-cache-repo | medium |
| TASK-403 | cache-keys (canonical JSON + sha256) | low |
| TASK-404 | cache-policy (withCache + TTL resolver) | medium |
| TASK-405 | Smart routing resolveAccountByHostId | low |
| TASK-406 | Wrap 7 cacheable tools | medium |
| TASK-407 | New tools invalidate-cache, cache-stats | low |
| TASK-408 | Register in index.ts + force_refresh schema | medium |
| TASK-409 | Docs + smoke + version bump + push | low |

## Out of scope (повтор)

- LRU eviction — v0.5
- Per-row encryption — never
- SWR для query cache — never
- Concurrent miss dedup mutex — v0.5
- OS keychain — v0.5
- Wordstat unblock (Direct OAuth app) — отдельный track
- Pagination >100 — отложено
- HTTP/SSE transport — never

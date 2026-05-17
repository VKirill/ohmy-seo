# SPEC: mcp-yandex-seo v0.5 — Generic API Gateway + Skill Enrichment

Дата: 2026-05-17. Базируется на ROADMAP.md и SPEC-v0.4.md.
Предыдущая версия: v0.4 (21 tools, query cache, smart routing, 4 OAuth accounts).

## Goal

Архитектурный pivot. Заменить 6 узких domain tools тремя generic API-gateway tools: `yandex_metrika_api`, `yandex_webmaster_api`, `yandex_direct_api`. Принимают любой `endpoint` + `method` + `params/body`, проксируют через тот же OAuth-broker и кеш-слой. Доменные знания (что какой endpoint делает, scopes, error codes) — в пользовательских skill'ах (`yandex-metrica`, `yandex-webmaster`, `yandex-direct`, `mutagen`), которые в этой же итерации дополняются `cookbook.md` с примерами вызовов.

Результат: покрытие Yandex API с ~10% до ~100% при сокращении 21 → 18 tools. Mutagen остаётся отдельным tool (узкий API + polling).

## Non-goals (v0.5)

- OS keychain master-key — v0.6
- Audit log `oauth_events` — v0.6
- Per-endpoint TTL pattern matching — v0.6
- Pagination autoscroll — v0.6
- LRU eviction — v0.6
- Concurrent miss mutex для generic — v0.6
- Polling helpers (Reports/Logs) — v0.6
- Backwards-compat shim для 6 удалённых — never (breaking)
- Mutagen через generic gateway — never (узкий, остаётся convenience)

## Acceptance criteria

- [ ] `npm run build` + `tsc --noEmit` зелёные
- [ ] PRAGMA user_version=3 без новой миграции (схема БД не меняется)
- [ ] Сохраняются все данные v0.4 (oauth_apps, accounts, inv_*, query_cache) после установки v0.5
- [ ] 18 tools зарегистрировано: 8 oauth + 4 inventory + 2 cache + 3 generic api + 1 mutagen
- [ ] Удалены: 6 narrow tool-обёрток + `src/lib/direct-client.ts`
- [ ] `src/lib/webmaster-client.ts` и `src/lib/metrika-client.ts` сохранены, используются ТОЛЬКО `inventory/refresher.ts`
- [ ] `yandex_metrika_api({endpoint, method?, params?, body?, account?, force_refresh?})` работает для GET и POST
- [ ] `yandex_webmaster_api(...)` работает
- [ ] `yandex_direct_api({..., client_login?})` работает с Bearer auth + опц. Client-Login
- [ ] Auth: Metrika/Webmaster → `OAuth <token>`; Direct → `Bearer <token>`
- [ ] Smart routing: endpoint содержит `/hosts/{host_id}/` уникальный в inventory → account резолвится автоматически
- [ ] GET кешируется (TTL `MCP_YANDEX_SEO_CACHE_TTL_API` default 3600s)
- [ ] POST/PUT/DELETE НЕ читают и НЕ пишут cache
- [ ] После успешного POST/PUT/DELETE на endpoint X — удаляются все GET-entries с args_json содержащим endpoint X или X/...
- [ ] force_refresh пропускает cache read для GET
- [ ] Error 4xx (кроме 401/403/429) — возвращается как `{ok:false, status, body}` в content
- [ ] 401/403 → throw AuthError; 429 → throw RateLimitError
- [ ] mutagen_competition без изменений
- [ ] 4 inventory tools работают (refresher всё ещё использует webmaster-client/metrika-client)
- [ ] 2 cache tools работают; CACHEABLE_TOOLS обновлён
- [ ] package.json version → 0.5.0
- [ ] README обновлён: migration table из 6 → generic, ссылки на skill'ы
- [ ] .env.example: `MCP_YANDEX_SEO_CACHE_TTL_API=3600` добавлен, 7 устаревших TTL_<TOOLNAME> удалены
- [ ] src/smoke.ts содержит generic-smoke (cache miss → hit → force_refresh → invalidation)
- [ ] Skill `yandex-metrica` дополнен `references/cookbook.md` ≥20 рецептов
- [ ] Skill `yandex-webmaster` дополнен `references/cookbook.md` ≥20 рецептов
- [ ] Skill `yandex-direct` дополнен `references/cookbook.md` ≥20 рецептов + Reports lifecycle + wordstat-via-direct mini-recipe
- [ ] Skill `mutagen` SKILL.md обновлён секцией "Using via mcp-yandex-seo"
- [ ] git commit: `v0.5.0: generic API gateway (3 tools) + skill enrichment + breaking removal of 6 narrow tools`

## Architecture decisions

1. **Unified gateway.** Все 3 generic tools — тонкие wrappers вокруг `executeApiCall(opts)` в `src/lib/api-gateway.ts`. Tool отвечает за Zod-валидацию входа, передачу `apiName` в gateway, формирование content.
2. **Endpoint как опаковая строка** (не structured object). Direct/Metrika/Webmaster имеют несовместимые structuring conventions; строка — то, что Claude и так пишет в курлах.
3. **Cache invalidation: prefix LIKE на args_json.** На write на endpoint X — удаляем GET-entries с args_json содержащим `"endpoint":"X"` или `"endpoint":"X/...`. SQLite LIKE с indexed tool_name фильтром.
4. **Error surfacing вместо throw для 4xx (Yandex).** Yandex многословен в error-bodies. Возвращаем `{ok:false, status, body}` в content. ИСКЛЮЧЕНИЯ: 401/403 → AuthError (broker делает refresh), 429 → RateLimitError.
5. **Per-api таблица в `endpoints-spec.ts`.** `{baseUrl, authPrefix, requiredScope, supportsClientLogin}`. Единственное место в коде где знают о различиях API.
6. **`client_login` только в `yandex_direct_api`** schema. У других — нет.
7. **Сохраняем webmaster-client.ts и metrika-client.ts** (только функции для inventory refresher). `direct-client.ts` — удаляем целиком.
8. **No backwards-compat для 6 удалённых tools.** Breaking. Skill cookbook содержит migration cheat-sheet.
9. **CACHEABLE_TOOLS = `['yandex_metrika_api', 'yandex_webmaster_api', 'yandex_direct_api', 'mutagen_competition']`.** Все три generic — единый TTL `MCP_YANDEX_SEO_CACHE_TTL_API` default 3600.
10. **Skill drift handling.** Skill'ы — single source of truth для endpoint catalog. Cookbook содержит дату последней верификации.

## Generic tool input schemas (pseudocode)

```ts
// yandex_metrika_api
{
  endpoint: z.string().min(1),
  method: z.enum(["GET","POST","PUT","DELETE"]).optional().default("GET"),
  params: z.record(z.unknown()).optional(),
  body: z.unknown().optional(),
  account: z.string().min(1).optional(),
  force_refresh: z.boolean().optional().default(false),
}

// yandex_webmaster_api — same shape

// yandex_direct_api — adds:
{
  ...,
  client_login: z.string().optional(),
}
```

Descriptions ≥200 chars с ссылками на skill'ы.

## api-gateway.ts pseudocode

```ts
async function executeApiCall(opts: ExecuteOpts): Promise<unknown> {
  const spec = getApiSpec(opts.apiName);
  const acc = resolveAccountForApi(opts);
  const token = await getAccessToken(acc.id);

  const url = buildUrl(spec.baseUrl, opts.endpoint, opts.params, opts.method);
  const headers = {
    Authorization: `${spec.authPrefix} ${token}`,
    ...(opts.method !== "GET" && opts.method !== "DELETE" ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    ...(spec.supportsClientLogin && opts.client_login ? { "Client-Login": opts.client_login } : {}),
  };
  const init = { method: opts.method, headers };
  if (opts.body !== undefined && (opts.method === "POST" || opts.method === "PUT")) {
    init.body = JSON.stringify(opts.body);
  }

  const isGet = opts.method === "GET";
  const toolName = `yandex_${opts.apiName}_api`;
  const cacheArgs = { endpoint, method, params: params ?? null, body: body ?? null };

  const doFetch = async () => {
    try {
      const { data, status } = await request(url, init);
      return { ok: true, status, data };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof RateLimitError) throw e;
      if (e instanceof ApiError) return { ok: false, status: e.status, body: tryJson(e.body) };
      throw e;
    }
  };

  if (!isGet) {
    const result = await doFetch();
    if (result.ok) invalidateOnWrite(toolName, opts.apiName, opts.endpoint);
    return result;
  }
  return withCache({toolName, accountId: acc.id, args: cacheArgs, forceRefresh: opts.force_refresh ?? false}, doFetch);
}
```

## Cache invalidation algorithm

```ts
function invalidateOnWrite(toolName, apiName, endpoint): number {
  const exactPattern = `%"endpoint":${JSON.stringify(endpoint)}%`;
  const subPattern   = `%"endpoint":"${endpoint}/%`;
  return db.prepare(`
    DELETE FROM query_cache
    WHERE tool_name = ?
      AND (args_json LIKE ? OR args_json LIKE ?)
  `).run(toolName, exactPattern, subPattern).changes;
}
```

Invalidation — ПОСЛЕ успешного write (ok=true).

## File plan

| File | Op | Target | Hard cap | Responsibility |
|---|---|---|---|---|
| `src/lib/api-gateway.ts` | New | ~220 | 350 | executeApiCall — main runner |
| `src/lib/api/endpoints-spec.ts` | New | ~70 | 150 | Per-API table (baseUrl, authPrefix, scope) |
| `src/lib/api/invalidation.ts` | New | ~60 | 150 | invalidateOnWrite prefix-LIKE |
| `src/lib/api/url-builder.ts` | New | ~50 | 120 | buildUrl(base, path, params, method) |
| `src/tools/yandex-metrika-api.ts` | New | ~45 | 100 | MCP wrapper |
| `src/tools/yandex-webmaster-api.ts` | New | ~45 | 100 | MCP wrapper |
| `src/tools/yandex-direct-api.ts` | New | ~50 | 110 | + client_login |
| 6 narrow tool files | DELETE | — | — | — |
| `src/lib/direct-client.ts` | DELETE | — | — | — |
| `src/lib/webmaster-client.ts` | Modify | -110 | 250 | Оставить только getHostsList + HostInfo |
| `src/lib/metrika-client.ts` | Modify | -120 | 250 | Оставить только getCountersList + CounterInfo |
| `src/index.ts` | Modify | -170/+120 | 600 | -6 registerTool, +3 generic |
| `src/lib/cache/cache-policy.ts` | Modify | -25/+30 | 200 | Update CACHEABLE_TOOLS, add `_API` env, drop 5 устаревших |
| `src/lib/cache/query-cache-repo.ts` | Modify | +20 | 250 | + deleteByEndpointPrefix |
| `src/lib/scopes.ts` | Modify | -8/+4 | 80 | REQUIRED_SCOPE_BY_TOOL под новые имена |
| `src/tools/invalidate-cache.ts` | Modify | +5 | 100 | Обновить enum фильтра tool |
| `src/smoke.ts` | Modify | +50/-20 | 450 | Generic smoke |
| `README.md` | Modify | +180/-100 | — | Tools section + migration table |
| `.env.example` | Modify | +1/-7 | — | _CACHE_TTL_API, drop устаревших |
| `package.json` | Modify | 0.5.0 | — | — |

## Skill enrichment plan

Skill'ы живут в `/home/ubuntu/.claude/skills/{yandex-metrica,yandex-webmaster,yandex-direct,mutagen}/`. НЕ копируем в проект.

| Skill | Что есть | Что добавить |
|---|---|---|
| `yandex-metrica` | SKILL.md + 10 references | `references/cookbook.md` (≥20 рецептов через `yandex_metrika_api`) |
| `yandex-webmaster` | SKILL.md + references | `references/cookbook.md` (≥20 рецептов через `yandex_webmaster_api`) |
| `yandex-direct` | SKILL.md + references | `references/cookbook.md` (≥20 рецептов + Reports lifecycle + wordstat-via-direct) |
| `mutagen` | SKILL.md + 17 references | SKILL.md секция "Using via mcp-yandex-seo" — короткий пример |

Sources:
- Metrika: `https://yandex.ru/dev/metrika/ru/` + context7 MCP
- Webmaster: `https://yandex.ru/dev/webmaster/ru/`
- Direct: `https://yandex.ru/dev/direct/ru/`
- Mutagen: `https://mutagen.ru/?p=api`

Cookbook template:
```markdown
# Cookbook — yandex_<api>_api recipes
Last verified: 2026-05-17

## 1. Reporting
### Top organic search phrases (replaces deleted metrika_search_phrases)
yandex_metrika_api({endpoint: "/stat/v1/data", params: {...}})

## 2. Management writes
### Create a goal
...

## Migration from v0.4 narrow tools
| Deleted | Replacement |
|---|---|
| metrika_search_phrases | yandex_metrika_api({endpoint:"/stat/v1/data", params:{dimensions:"ym:s:searchPhrase",...}}) |
...
```

## Risks & mitigation

1. **LLM конструирует кривой URL → 404 silently кешируется.**  
   *Mitigation:* skill cookbook examples; cache writes ТОЛЬКО на 2xx (gateway проверяет `result.ok`).
2. **Write cache poisoning без invalidation.**  
   *Mitigation:* prefix-LIKE pattern; `invalidate_cache({})` как kill-switch.
3. **Bypass auth scope через generic** — gateway проверяет минимум scope, Яндекс enforce'ит остальное.  
   *Mitigation:* OK — Yandex сам авторитет.
4. **Direct требует Client-Login для агентов** — Claude может забыть.  
   *Mitigation:* cookbook explicit examples + warning в description.
5. **Massive responses не помещаются в context.**  
   *Mitigation:* description рекомендует limit≤500.
6. **Skill drift** — документация устаревает.  
   *Mitigation:* Last verified в cookbook; quarterly refresh.
7. **Backwards-compat** — старые tools удалены.  
   *Mitigation:* README migration table; первый вызов удалённого tool вернёт MCP error "tool not found".
8. **Endpoint typos silently cached as 404** — покрыто #1.
9. **Concurrent gateway calls — нет mutex.** Accept для v0.5; token-broker уже имеет mutex.
10. **Direct sandbox vs production** — env `DIRECT_USE_SANDBOX` уже глобальный, теперь только gateway его читает.
11. **Skill enrichment — 4 параллельных потока markdown.** Один template на все три cookbook'а.
12. **Orphan query_cache entries после апгрейда** — старые tool_name строки.  
   *Mitigation:* они никогда не hit'нутся; README рекомендует `invalidate_cache({})` после апгрейда.

## Decomposition (12 tasks)

Code track (sequential): 501 → 502 → 503 → 504 → 505.
Skills track (parallel after 503): 506, 507, 508, 509.
Tail: 510 → 511 → 512.

| Task | Title | Risk |
|---|---|---|
| TASK-501 | endpoints-spec + url-builder + api-gateway skeleton | medium |
| TASK-502 | invalidation + integration в gateway | medium |
| TASK-503 | 3 generic tool wrappers + register + cache-policy update | medium |
| TASK-504 | Delete 6 narrow tools + direct-client | medium |
| TASK-505 | Cleanup clients + scopes + invalidate-cache enum | low |
| TASK-506 | yandex-metrica cookbook | low |
| TASK-507 | yandex-webmaster cookbook | low |
| TASK-508 | yandex-direct cookbook + Reports lifecycle | low |
| TASK-509 | mutagen SKILL.md update | low |
| TASK-510 | README + smoke + .env + version 0.5.0 | low |
| TASK-511 | Integration smoke против реального Yandex | medium |
| TASK-512 | Final review + commit + push | low |

## Out of scope (повтор)

- OS keychain — v0.6
- Audit log — v0.6
- Per-endpoint TTL — v0.6
- Pagination autoscroll — v0.6
- LRU eviction — v0.6
- Polling helpers — v0.6
- Migration shim — never
- Mutagen через generic — never

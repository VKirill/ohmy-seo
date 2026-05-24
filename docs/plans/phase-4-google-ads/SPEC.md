# SPEC: Phase 4 — Google Ads (`@ohmy-seo/google-ads`) + skill `google-ads-api`

> Output of feature-planner (2026-05-21). 30 tasks across 9 waves. Mirrors Phase 3 architecture exactly — no redesign.

## 1. Goal

Ship `@ohmy-seo/google-ads` (bin `mcp-google-ads`, v0.1.0) — a new sibling MCP package giving an autonomous agent full Google Ads coverage: read campaigns / ad groups / keywords / ads, run GAQL reports (performance, search terms, change history, recommendations), write non-DANGER mutations (create campaign / budget / ad group, add keywords, apply recommendations), and two-step DANGER mutations (enable / pause campaign, update budget, remove keywords / ads / campaigns). Auth via the existing core Google OAuth broker (user-flow `adwords` scope) plus a static developer-token header. After merge — 7 MCP servers total (yandex-seo, mutagen, xmlstock, gsc, ga4, gtm, google-ads), one new skill `google-ads-api` covering API v20 (verified at implementation time), one user-gate for OAuth + developer-token onboarding.

## 2. Why now / scope

- Phase 3 закрыла бесплатные Google-сервисы (GSC, GA4, GTM). Google Ads — последний крупный Google-API, нужный агенту для авто-управления рекламой (отчёты + мусорные минус-слова + пауза неэффективных кампаний).
- Архитектурный шаблон отработан: 3 пакета Phase 3 идентичны. Phase 4 копирует — никакой новой инфраструктуры, только новый клиент + GAQL слой + developer-token заголовок.
- Скилл `google-ads-spec` уже есть (креатив-сторона: рекомендации, политики, лимиты текстов). Скилл `google-ads-api` отсутствует — этот SPEC его создаёт, не дублируя `-spec`.

## 3. Out of scope

- gRPC client (REST only для v0.1 — паритет с GSC/GA4/GTM, нулевые новые зависимости).
- MCC (Manager Account) management: создание/линковка sub-accounts. Заголовок `login-customer-id` поддержан в клиенте на чтение, но dedicated MCC-tools не делаем.
- Conversions API offline uploads (отдельная фаза — PII-sensitive).
- Customer Match audience uploads (отдельная фаза — PII-sensitive).
- Asset library management (images/videos for Performance Max — отдельная фаза).
- Bid simulator, budget forecasting, keyword planner ideas (post-v0.1).
- Creative validation, RSA/PMax asset rules — это ответственность скилла `google-ads-spec`. Cross-link, не дублируем.
- BigQuery export, реклама в YouTube Studio, Merchant Center.

In scope explicitly:
- Один generic `ads_run_query` (raw GAQL) + 5 curated высокочастотных отчётов поверх.
- `ads_apply_recommendation` — single-recommendation accept (без bulk-apply).
- `ads_change_history` через resource `change_event`.

## 4. Architecture decisions — parity table (mirror Phase 3)

| Convention | Phase 3 | Phase 4 — `google-ads` | Deviation? |
|---|---|---|---|
| ENV_PREFIX_MAP key | `gtm → MCP_GTM` | `google-ads → MCP_GOOGLE_ADS` | none |
| Master-key fail-fast at startup | `resolvePackageConfig("gtm")` в `validateRequiredEnv` | `resolvePackageConfig("google-ads")` | none |
| `getDb(packageName)` package-aware | Map keyed by pkg name | same, `getDb("google-ads")` | none |
| Per-pkg oauth-apps-repo + accounts-repo | `PKG = "gtm"` constant в repos | `PKG = "google-ads"` | none |
| Per-pkg account-resolver | scope-check via `scopes_granted.split(" ")` | same, required scope = `adwords` | none |
| 9 shared OAuth tools | копия 9 файлов в `src/tools/` | копия 9 файлов в `src/tools/` (no shared helper exists yet — preserve the per-pkg pattern) | none |
| Cache via `@ohmy-seo/core` cache-repo | namespace per pkg, key incl. account+args | same; key incl. customer_id + GAQL-hash для `run_query` | none |
| Smoke test с `--only` flag | да | да | none |
| Idempotent smoke (TASK-912B lesson) | `DELETE ... WHERE args_hash = ?` пре-cleanup | same | none |
| Confirm-gate для DANGER | `assertConfirm + assertAcknowledgeLive` из `lib/confirm-gate.ts` | копия `lib/confirm-gate.ts` в `google-ads/src/lib/`. `acknowledge_live` format: `I-UNDERSTAND-THIS-IS-LIVE:<customerId>:<resourceId>` | формат токена расширен: customer + ресурс (резоны: одна и та же customer_id может содержать сотни кампаний, цена ошибки выше чем у GTM-version-publish) |
| Etag/fingerprint cache | GTM only | НЕ нужен — Google Ads API не использует etag/If-Match | deviation, обоснован |
| File-line budgets | как Phase 3 §4.6 | те же | none |
| `~/.claude.json` entry | один на пакет | один на пакет (`mcp-google-ads`) | none |

### 4.1. Developer token storage — Option A (env var, app-wide)

Один developer-token на MCP-деплой → `process.env.GOOGLE_ADS_DEVELOPER_TOKEN`. Прочитан один раз при старте сервера через `validateRequiredEnv`, fail-fast если отсутствует. Передаётся в каждый запрос как HTTP-заголовок `developer-token: <value>`.

Альтернатива (отвергнута для v0.1): колонка на `google_oauth_apps` — нужна агенту-агентству, обслуживающему N клиентов с разными dev-token. Не наш кейс. Если понадобится — V5 миграция добавит `developer_token_enc BLOB` в `google_oauth_apps`, breaking-change минимальный.

Дополнительный safety env: `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=false` (default). При `false` все WRITE и DANGER tools возвращают только preview даже с `confirm:true`. Пользователь явно ставит `true` перед первым реальным мутирующим вызовом.

### 4.2. login-customer-id header — optional, передаётся если задан

Клиент `ads-client.ts` принимает опциональный `loginCustomerId` параметр. Если задан — добавляется заголовок `login-customer-id: <10-digit>`. На уровне tools этот параметр выставляется опциональным аргументом `login_customer_id` (для MCC-доступа). Default — не передаётся (direct customer access).

### 4.3. Cache TTL per tool

| Tool group | TTL | Reasoning |
|---|---|---|
| `ads_list_accessible_customers` | 24 h | Меняется при добавлении линковки |
| `ads_get_customer` | 24 h | Метаданные клиента |
| `ads_list_campaigns / _ad_groups / _ads / _keywords / _negative_keywords / _budgets / _audiences` | 1 h | Edit-цикл возможен |
| `ads_run_query` (generic GAQL) | 1 h | Key includes hash(query+params) |
| `ads_*_report` (search_terms, keyword_perf, campaign_perf) | 1 h | Reports volatile, repeat-heavy |
| `ads_change_history` | 1 h | Append-only лог |
| `ads_recommendations` | 1 h | Меняются с задержкой |
| All WRITE + DANGER tools | uncached + on-write invalidate | — |

Invalidate-on-write: после успешной мутации tool вызывает `invalidateCache` по prefix `ads_*` для затронутого customer_id. Минимальный паттерн — без selective invalidation per resource (KISS).

### 4.4. Rate-limit / retry strategy

Google Ads API возвращает `RESOURCE_EXHAUSTED` (429-like, но gRPC-status в REST mapped to HTTP 429) с retry-info в response body. Клиент:
1. На 429 / `RESOURCE_EXHAUSTED` → parse `retry_delay.seconds` из ошибки, sleep, ретрай 1 раз. Если снова — fail с явным сообщением.
2. На 401 → классификация через `classifyGoogleError` (re-use из core) → `re_auth_required` сообщение для пользователя.
3. На 403 + `INVALID_DEVELOPER_TOKEN` → fail с инструкцией проверить env-var и Google Ads Center status.
4. На любую `GoogleAdsFailure` ошибку (HTTP 400 с body containing `errors[]`) — возвращаем структурированный список `{error_code, message, trigger}`. НЕ скрываем под generic "request failed".

### 4.5. File-line budgets

Те же что Phase 3 §4.6:
- `src/index.ts`: 380-480 (cap 550 — больше tools + dev-token wiring)
- `src/tools/*.ts`: 70-150 (cap 200)
- `src/lib/ads-client.ts`: 180-260 (cap 320)
- `src/lib/gaql-builder.ts`: 100-180 (cap 250)
- `src/lib/confirm-gate.ts`: копия из GTM, ~100
- `src/smoke.ts`: 100-180 (cap 220)

## 5. Package layout

```
packages/
├── core/                                       # MODIFIED — only scopes.ts: add SCOPE_ADWORDS
│   └── src/google-oauth/scopes.ts              # +1 export, +1 array entry
└── google-ads/                                 # NEW
    ├── package.json (bin: mcp-google-ads → dist/index.js, v0.1.0)
    ├── tsconfig.json
    ├── .env.example
    ├── README.md
    ├── data/.gitkeep
    └── src/
        ├── index.ts                            # MCP server entry, registerTool wiring
        ├── smoke.ts                            # idempotent smoke runner with --only
        ├── lib/
        │   ├── ads-client.ts                   # HTTP client; developer-token + login-customer-id headers; retry on 429
        │   ├── gaql-builder.ts                 # type-safe GAQL string composer (SELECT/FROM/WHERE/ORDER/LIMIT)
        │   ├── confirm-gate.ts                 # copied from gtm/lib/confirm-gate.ts; acknowledge token includes customer_id+resource_id
        │   ├── account-resolver.ts             # copy of gtm version, PKG="google-ads", required scope=adwords
        │   └── db/
        │       ├── oauth-apps-repo.ts          # copy, PKG="google-ads"
        │       └── accounts-repo.ts            # copy, PKG="google-ads"
        └── tools/
            # 9 OAuth (copied, identical bodies)
            ├── list-google-oauth-apps.ts
            ├── register-google-oauth-app.ts
            ├── delete-google-oauth-app.ts
            ├── list-google-accounts.ts
            ├── start-google-oauth-flow.ts
            ├── complete-google-oauth-flow.ts
            ├── delete-google-account.ts
            ├── set-default-google-account.ts
            ├── register-google-service-account.ts
            # Read (8)
            ├── ads-list-accessible-customers.ts
            ├── ads-get-customer.ts
            ├── ads-list-campaigns.ts
            ├── ads-list-ad-groups.ts
            ├── ads-list-ads.ts
            ├── ads-list-keywords.ts
            ├── ads-list-negative-keywords.ts
            ├── ads-list-budgets.ts
            # GAQL / reports (6)
            ├── ads-run-query.ts
            ├── ads-search-terms-report.ts
            ├── ads-keyword-performance-report.ts
            ├── ads-campaign-performance-report.ts
            ├── ads-change-history.ts
            ├── ads-recommendations.ts
            # Write non-DANGER (6)
            ├── ads-create-campaign-budget.ts
            ├── ads-create-campaign.ts          # paused-by-default
            ├── ads-create-ad-group.ts
            ├── ads-add-keywords.ts
            ├── ads-add-negative-keywords.ts
            ├── ads-apply-recommendation.ts
            # DANGER (7, two-step confirm)
            ├── ads-enable-campaign.ts
            ├── ads-pause-campaign.ts
            ├── ads-update-budget.ts
            ├── ads-remove-keywords.ts
            ├── ads-remove-negative-keywords.ts
            ├── ads-remove-ads.ts
            └── ads-remove-campaign.ts
```

Tool count: **9 OAuth + 8 read + 6 GAQL/reports + 6 write non-DANGER + 7 DANGER = 36 tools.**

## 6. MCP tools — full inventory

### 6.1. OAuth management (9, inherited shape)

Идентичны Phase 3, копия per-file. Tool names НЕ меняются (для UX-консистентности `register_google_oauth_app` один и тот же шейп везде).

### 6.2. Read (8, cached 24 h or 1 h)

| Tool | Cache | GAQL/Endpoint | Required args |
|---|---|---|---|
| `ads_list_accessible_customers` | 24 h | `GET customers:listAccessibleCustomers` | `account` (opt) |
| `ads_get_customer` | 24 h | GAQL `SELECT ... FROM customer` | `customer_id` |
| `ads_list_campaigns` | 1 h | GAQL `SELECT ... FROM campaign` | `customer_id`, опц. `status_filter` |
| `ads_list_ad_groups` | 1 h | GAQL `SELECT ... FROM ad_group` | `customer_id`, опц. `campaign_id` |
| `ads_list_ads` | 1 h | GAQL `SELECT ... FROM ad_group_ad` | `customer_id`, опц. `ad_group_id` |
| `ads_list_keywords` | 1 h | GAQL `SELECT ... FROM ad_group_criterion WHERE type = KEYWORD` | `customer_id`, опц. `ad_group_id` |
| `ads_list_negative_keywords` | 1 h | GAQL with `negative = TRUE` filter | `customer_id` |
| `ads_list_budgets` | 1 h | GAQL `SELECT ... FROM campaign_budget` | `customer_id` |

### 6.3. GAQL / reports (6, cached 1 h)

| Tool | Cache | Notes |
|---|---|---|
| `ads_run_query` | 1 h (key = hash(query+customer_id)) | Generic GAQL. Raw `query` string. Validates basic shape: must start with SELECT, must contain FROM. |
| `ads_search_terms_report` | 1 h | Pre-built GAQL over `search_term_view`. The "мусорные запросы cleanup" daily-driver. Params: `customer_id`, `date_range`, `min_impressions` (default 10). |
| `ads_keyword_performance_report` | 1 h | Pre-built over `keyword_view`. Params: `customer_id`, `date_range`, `campaign_id` (opt). |
| `ads_campaign_performance_report` | 1 h | Pre-built over `campaign`. Params: `customer_id`, `date_range`. |
| `ads_change_history` | 1 h | Over `change_event`. Last 30 days hard cap (API limit). |
| `ads_recommendations` | 1 h | Over `recommendation`. Returns per-recommendation `resource_name` for use with `apply_recommendation`. |

### 6.4. Write non-DANGER (6)

| Tool | Notes |
|---|---|
| `ads_create_campaign_budget` | POST `customers/{id}/campaignBudgets:mutate` with `operations[0].create`. Validates `amount_micros > 0`. |
| `ads_create_campaign` | POST `customers/{id}/campaigns:mutate`. **Forces `status: PAUSED`** independent of agent input (safety; agent must explicitly enable later via DANGER tool). |
| `ads_create_ad_group` | POST `customers/{id}/adGroups:mutate`. Status PAUSED by default unless `confirm_enabled: true` (single-flag exception — ad groups inside a paused campaign are effectively dormant). |
| `ads_add_keywords` | POST `customers/{id}/adGroupCriteria:mutate` with `operations[].create`. Accepts array of `{text, match_type}`. |
| `ads_add_negative_keywords` | Same endpoint, with `negative: true`. Campaign-level or ad-group-level via `parent_resource`. |
| `ads_apply_recommendation` | POST `customers/{id}/recommendations:apply`. Single recommendation per call (no bulk). |

### 6.5. DANGER (7, confirm + acknowledge_live)

Format of `acknowledge_live`: **`I-UNDERSTAND-THIS-IS-LIVE:<customer_id>:<resource_id>`**, e.g. `I-UNDERSTAND-THIS-IS-LIVE:1234567890:campaigns/9876543210`. Echo-of-target prevents copy-paste cargo-culting across customers.

Two-step protocol (mirror GTM `gtm_publish_version`):
- `confirm: false` (default) → returns `DryRunPreview` with target, change, next_step.
- `confirm: true` + valid `acknowledge_live` → execute.
- `confirm: true` без `acknowledge_live` (или mismatch) → throws `AcknowledgeLiveError`.

Additional gate: env `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true` обязателен для всех 7 DANGER tools. Если `false` (default) — tool возвращает hard-error даже с правильным acknowledge_live.

| Tool | Endpoint |
|---|---|
| `ads_enable_campaign` | `customers/{id}/campaigns:mutate` op=update, status=ENABLED |
| `ads_pause_campaign` | same, status=PAUSED |
| `ads_update_budget` | `customers/{id}/campaignBudgets:mutate` op=update, amount_micros change |
| `ads_remove_keywords` | `customers/{id}/adGroupCriteria:mutate` op=remove |
| `ads_remove_negative_keywords` | same, on negative criteria |
| `ads_remove_ads` | `customers/{id}/adGroupAds:mutate` op=remove |
| `ads_remove_campaign` | `customers/{id}/campaigns:mutate` op=remove (irreversible) |

## 7. Database migration — V5 NOT needed

Hypothesis confirmed by reading `packages/core/src/db/migrations.ts`:
- V4 schema (`google_oauth_apps`, `google_accounts`) полностью покрывает Google Ads. Колонки generic по `package_name` (через `PKG` константу в repos).
- Developer token хранится в env (decision §4.1), не в DB.
- No new tables required for Google Ads — `query_cache` уже packages-aware через `account_namespace`.

**Conclusion: V5 миграция не нужна. `packages/core` остаётся v0.3.0 (точечно bump до 0.3.1 за счёт ENV_PREFIX_MAP +1 entry).**

## 8. Skill `google-ads-api` outline

Path: `~/.claude/skills/google-ads-api/SKILL.md` + references. Mirrors structure of `~/.claude/skills/google-search-console/`.

### 8.1. Frontmatter (template)

```yaml
---
name: google-ads-api
description: |
  Use when working programmatically with Google Ads API via REST: GAQL reports
  (campaign / keyword / search terms / change history), creating or mutating
  campaigns / ad groups / keywords / budgets, applying recommendations,
  managing audiences (read-only here). For creative-side rules (RSA limits,
  policy compliance, ad strength heuristics) use the sibling skill
  `google-ads-spec`.
allowed-tools: WebFetch, Read, Glob, Grep, Bash(curl:*)
---
```

### 8.2. Sections

1. **API version & endpoints (verified at write time)** — current GA likely v20 as of 2026-05; worker MUST verify via `curl https://googleads.googleapis.com/$discovery/rest` and pin version.
2. **Auth headers (three)** — Bearer OAuth + developer-token + optional login-customer-id.
3. **GAQL essentials** — syntax, resource list, no JOIN, segments, date ranges.
4. **Mutation pattern** — operations[] create/update/remove, update_mask, partial_failure flag.
5. **Pagination** — page_size max 10 000, page_token loop.
6. **Error handling — `GoogleAdsFailure` shape** — error_code enum, common codes, retry policy.
7. **Cookbook (use cases user explicitly named + high-frequency ones)** — list customers, campaign perf report, add negative keyword, pause underperforming campaign, identify low-quality search terms ("мусорные запросы"), apply recommendation, list ad groups.
8. **Rate limits + retry guidance** — daily per-token + per-minute per-customer.
9. **Russia warning (cross-reference `google-ads-spec`)** — Google Ads недоступен для размещения в РФ с 22.09.2022.
10. **Cross-link to `google-ads-spec`** — creative validation handled there, не дублировать.
11. **References sub-files** — setup.md, gaql.md, mutations.md, reports.md, recommendations.md, errors.md, rate-limits.md, integration.md.

## 9. Acceptance criteria

- [ ] `pnpm -r build` passes clean from monorepo root (no TS errors, no peer warnings)
- [ ] `pnpm --filter @ohmy-seo/google-ads smoke --only=cache` passes (idempotent — re-runnable)
- [ ] `pnpm --filter @ohmy-seo/google-ads smoke --only=list_accounts_empty` passes on fresh DB
- [ ] `pnpm --filter @ohmy-seo/google-ads smoke --only=oauth_apps_crud` passes
- [ ] All 36 tools visible via `/mcp` in a fresh Claude Code session after `~/.claude.json` registration
- [ ] `ads_run_query` returns parsed rows for a real customer with developer-token configured (Gate B)
- [ ] `ads_list_campaigns` cache hit observed on second call within 1 h
- [ ] DANGER tool `ads_pause_campaign` rejects `confirm:true` without `acknowledge_live`
- [ ] DANGER tool `ads_pause_campaign` rejects mismatched `acknowledge_live` (wrong customer_id or wrong campaign_id)
- [ ] DANGER tool `ads_pause_campaign` rejects `confirm:true + acknowledge_live` when `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=false`
- [ ] No secrets (access_token, refresh_token, developer-token, client_secret) appear in any log line
- [ ] `register_google_oauth_app` writes encrypted `client_secret_enc` (verify BLOB starts with non-printable bytes, not plaintext)
- [ ] `ads_create_campaign` always sets `status: PAUSED` regardless of agent input
- [ ] Retry-on-429 happens at most once per tool call (verified via fault-injection unit test)
- [ ] Skill `google-ads-api/SKILL.md` exists, frontmatter valid, references/ has 8 files
- [ ] Skill cookbook examples actually parse as valid GAQL (no typos)
- [ ] Root README + AGENTS.md mention `mcp-google-ads` in MCP-servers table
- [ ] `~/.claude.json` has `mcp-google-ads` entry alongside the other 6

## 10. Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Случайный enable/remove кампании реальным деньгам | **critical** | confirm-gate + acknowledge_live с customer_id+resource_id + env-flag `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=false` default |
| Developer-token approval может занять 1–3 дня; пользователь не сможет смокать | medium | User-gate в plan; до approval — smoke режим без live-вызовов |
| Test-tier dev-token не работает с live customer-id | medium | Документ в `references/setup.md`; ошибку парсим как `INVALID_DEVELOPER_TOKEN` с подсказкой об апгрейде на Basic |
| API-version drift (v20 → v21 в течение Phase 4 implementation) | low | Версия читается из единой константы `ADS_API_VERSION` в `ads-client.ts`; ручной bump |
| Rate-limit cascading при первом запуске агента (много `ads_list_*`) | medium | Cache 1h + retry-once on 429 |
| Утечка developer-token в логи | high | Никогда не логируем headers; redactSecret обёртка над console.error в client |
| GAQL injection (агент строит query из user-input строк) | medium | `ads_run_query` валидирует shape (no semicolons, no `;DROP`, single statement); curated reports используют типизированные параметры |
| `partial_failure: true` ловушка — половина операций применилась, агент думает что всё ОК | low | По умолчанию `partial_failure: false`; все наши mutate-tools посылают одну операцию за вызов в v0.1 |
| 36 tools — раздут tool list агента | low | Префикс `ads_` группирует; альтернатива (merge в `ads_action(verb, args)`) хуже для discoverability |
| Skill `google-ads-api` дублирует креатив-правила из `google-ads-spec` | low | Cross-link в frontmatter + явная секция §10 в skill body |

## 11. Task breakdown — 9 waves, 30 tasks (TASK-2001 … TASK-2030)

See `CHECKLIST.md` for the YAML breakdown ingested by orchestrator-db.

## 12. User gates expected

- **Gate A** — approve Option A for developer-token storage (env var, not DB) — answer before Wave 8
- **Gate B** — confirm `GOOGLE_ADS_DEVELOPER_TOKEN` value provided in `.env` — before TASK-2030
- **Gate C** — confirm OAuth `adwords` scope granted in browser flow — during TASK-2030
- **Gate D** — confirm `~/.claude.json` diff before write — TASK-2028
- **Gate E** — explicit user toggle `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=true` before first DANGER call (no automation does this)

## 13. Open questions for user (BLOCK Wave 8)

1. Developer-token уже approved у Google или подавать заявку прямо сейчас? Test-tier обычно одобряют за 24 ч, Basic — 1–3 рабочих дня.
2. Использовать тот же Google account, что Phase 3 (GSC/GA4/GTM), или отдельный для Ads? Технически — отдельный label в `google_accounts`; пользователь линкует Ads-OAuth поверх существующего OAuth-app или регистрирует новый.
3. Есть MCC (Manager Account) или только direct customer access? Влияет на необходимость `login_customer_id` параметра на каждом tool.
4. Подтвердить дефолт `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS=false` — агент не сможет исполнить ни один DANGER tool без явной user-команды переключить env.

---

**Estimated:** ~3 800 LOC new (36 tools × ~100 LOC + client/builder/gate ~600 LOC + smoke ~150 + skill ~900 markdown), 35 files new, 2 files modified (`packages/core/src/config/package-config.ts`, `packages/core/src/google-oauth/scopes.ts`), 1 file in `~/.claude.json`, 30 tasks, 5 user gates.

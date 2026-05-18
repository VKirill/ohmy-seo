# SPEC: Phase 3 — Google SEO (GSC + GA4 + GTM)

> Output of feature-planner agent (May 2026). 34 tasks across 8 waves.

## 1. Goal

Extract Google SEO capabilities into 3 sibling packages — `@ohmy-seo/google-search-console` (mcp-gsc), `@ohmy-seo/ga4` (mcp-ga4), `@ohmy-seo/gtm` (mcp-gtm) — sharing a common Google OAuth broker (user-flow + Service Account), encrypted token storage, and the established cache/db/crypto primitives from `@ohmy-seo/mcp-core`. Pattern mirrors Phase 2 split (one sibling per service, codex review) and Yandex OAuth flow from Phase 1 (per-account broker with mutex + AES-GCM at rest). After merge the user has 6 MCP servers total (yandex-seo, mutagen, xmlstock, gsc, ga4, gtm) and can drive RU+Global SEO analytics, indexing, and tag deployment from chat.

## 2. Why now / scope

- Yandex + Mutagen + XMLStock закрывают RU-сторону. Google — недостающее плечо для глобальной SEO.
- 4 Google-скилла (`google-cloud-auth`, `google-search-console`, `ga4-data-api`, `gtm`) уже написаны — авторитетный источник API-деталей под рукой.
- GSC `searchanalytics.query` — daily-driver, который пользователь хочет в чате каждый день (queries / pages / countries / devices).
- GA4 закрывает property-аналитику (RU = Metrika уже есть, Global = GA4).
- GTM открывает managed deployment тегов — write-операции с git-style version + publish.

## 3. Out of scope

- Google Ads / AdSense API
- BigQuery export для GSC и GA4
- Lighthouse / PageSpeed Insights
- Google Business Profile
- GTM Server-side container (`gtm-ss`)
- YouTube Data API, YouTube Analytics — отдельная фаза
- Multi-region OAuth (Google Workspace domain-wide delegation)

In scope explicitly:
- GA4 Realtime — один tool (`ga4_run_realtime_report`)
- GA4 Admin API — да, не только Data API
- GSC Indexing API — да, только JobPosting + BroadcastEvent (это лимит API)
- GTM write-ops + publish + rollback — под двухступенчатым подтверждением

## 4. Architecture decisions

### 4.1. OAuth broker — внутри `@ohmy-seo/mcp-core/google-oauth/`

3 пакета используют идентичный код OAuth — выносим в core. Bump core `0.2.0 → 0.3.0`. Yandex OAuth остаётся в yandex-seo (только там нужен).

### 4.2. Token storage — per-package DBs

Schema `google_accounts` + `google_oauth_apps` поставляется через миграцию V4 в core. Каждый пакет применяет миграцию lazy. Пользователь линкует один Google-account 3 раза (sliced UX-боль за процессную изоляцию).

### 4.3. Service Account vs User OAuth — оба поддерживаются

Column `auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth_user','service_account'))`. Broker `getGoogleAccessToken(accountId)` ветвится внутри.

### 4.4. GTM write-op safety — двухступенчатая защита

- `confirm: true` обязателен на каждом write-tool (default false → dry-run preview)
- `gtm_publish_version` + `gtm_rollback` дополнительно требуют `acknowledge_live: "I-UNDERSTAND-THIS-IS-LIVE"` (literal string)
- Rollback двухступенчатый: первый вызов с `confirm: false` → preview, второй вызов в окне 60 s с `confirm: true` → publish

### 4.5. Cache TTL per tool

| Tool | TTL | Reasoning |
|---|---|---|
| `gsc_search_analytics` | 3600 s | Data lag 2-3 дня + repeat-heavy |
| `gsc_list_sites/sitemaps` | 86400 s | Меняется редко |
| `gsc_url_inspection` | 3600 s | Quota-bound |
| GSC write ops | uncached | — |
| `ga4_run_report/batch/pivot` | 3600 s | Volatile + repeat-heavy |
| `ga4_run_realtime_report` | **uncached** | По определению |
| `ga4_list_*` / `get_metadata` | 86400 s | Меняется редко |
| `gtm_list_*` (read) | 3600 s | Read |
| `gtm_list_versions` | 300 s | Edit-цикл активный |
| GTM write ops | uncached + invalidateOnWrite | — |

### 4.6. File-line budgets

- `index.ts`: 250-400 (cap 500)
- `tools/*.ts`: 60-130 (cap 180)
- `lib/**/*.ts`: 120-250 (cap 280)
- `lib/oauth/google-flow.ts`: 180-260 (cap 320)
- `smoke.ts`: 80-150 (cap 200)

### 4.7. `~/.claude.json` — 3 раздельные записи

`mcp-gsc`, `mcp-ga4`, `mcp-gtm` рядом с существующими. После Phase 3 — 6 MCP entries total.

## 5. Package layout

```
packages/
├── core/                                       # MODIFIED (+google-oauth/ + V4 migration)
│   └── src/google-oauth/
│       ├── index.ts
│       ├── oauth-user-flow.ts
│       ├── service-account-flow.ts
│       ├── token-broker.ts
│       ├── scopes.ts
│       └── errors.ts
├── yandex-seo/                                 # untouched
├── mutagen/                                    # untouched
├── xmlstock/                                   # untouched
├── google-search-console/                      # NEW
│   ├── package.json (bin: mcp-gsc → dist/index.js, v0.1.0)
│   └── src/{index.ts, smoke.ts, lib/{gsc-client.ts, account-resolver.ts, db/, scopes.ts}, tools/}
├── ga4/                                        # NEW
│   ├── package.json (bin: mcp-ga4 → dist/index.js, v0.1.0)
│   └── src/{index.ts, smoke.ts, lib/{ga4-client.ts, ...}, tools/}
└── gtm/                                        # NEW
    ├── package.json (bin: mcp-gtm → dist/index.js, v0.1.0)
    └── src/{index.ts, smoke.ts, lib/{gtm-client.ts, confirm-gate.ts, etag-cache.ts, ...}, tools/}
```

## 6. MCP tools (financial breakdown)

### GSC (`mcp-gsc`) — 17 tools total

| Tool | Risk | Cache | Required scope |
|---|---|---|---|
| `gsc_list_sites` | low | 24h | `webmasters.readonly` |
| `gsc_search_analytics` | low | 1h | `webmasters.readonly` |
| `gsc_url_inspection` | low | 1h | `webmasters.readonly` |
| `gsc_list_sitemaps` | low | 24h | `webmasters.readonly` |
| `gsc_submit_sitemap` | medium | uncached | `webmasters` |
| `gsc_delete_sitemap` | medium | uncached | `webmasters` |
| `gsc_indexing_publish` | medium | uncached | `indexing` |

+ 8 OAuth/account mgmt + 2 cache tools.

### GA4 (`mcp-ga4`) — 18 tools total

| Tool | Risk | Cache | Required scope |
|---|---|---|---|
| `ga4_list_properties` | low | 24h | `analytics.readonly` |
| `ga4_run_report` | low | 1h | `analytics.readonly` |
| `ga4_run_realtime_report` | low | **none** | `analytics.readonly` |
| `ga4_batch_run_reports` | low | 1h | `analytics.readonly` |
| `ga4_run_pivot_report` | low | 1h | `analytics.readonly` |
| `ga4_get_metadata` | low | 24h | `analytics.readonly` |
| `ga4_list_custom_dimensions` | low | 24h | `analytics.readonly` |
| `ga4_list_conversion_events` | low | 24h | `analytics.readonly` |

+ 8 OAuth/account mgmt + 2 cache.

### GTM (`mcp-gtm`) — 27 tools total

**Read (no confirm):**
- `gtm_list_accounts`, `_containers`, `_workspaces`, `_tags`, `_triggers`, `_variables`, `_versions`, `_get_version`

**Write (require `confirm: true`):**
- `gtm_create_workspace`, `_create_tag`, `_update_tag`, `_delete_tag`, `_create_trigger`, `_create_variable`, `_create_version`

**DANGER (`confirm: true` + `acknowledge_live`):**
- `gtm_publish_version`, `gtm_rollback`

+ 8 OAuth/account mgmt + 2 cache.

## 7. Database migration V4 (in core)

```sql
CREATE TABLE IF NOT EXISTS google_oauth_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc BLOB NOT NULL,
  scopes_declared TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS google_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT UNIQUE NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('oauth_user','service_account')),
  oauth_app_id INTEGER REFERENCES google_oauth_apps(id) ON DELETE RESTRICT,
  google_email TEXT,
  google_project_id TEXT,
  access_token_enc BLOB,
  refresh_token_enc BLOB,
  service_account_json_enc BLOB,
  expires_at INTEGER NOT NULL DEFAULT 0,
  scopes_granted TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_google_accounts_default ON google_accounts(is_default) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_google_accounts_method  ON google_accounts(auth_method);
```

## 8. OAuth setup (user-facing)

### Path A — User OAuth

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID (Web app)
2. Enable: Search Console API, GA Data API, GA Admin API, Tag Manager API, Indexing API
3. Chat: `register_google_oauth_app({label, client_id, client_secret, scopes_declared, redirect_uri})`
4. `start_google_oauth_flow({app_label, account_label})` → returns URL
5. Browser → grant → loopback callback OR paste OOB code
6. `set_default_google_account({label})`

### Path B — Service Account

1. Cloud Console → IAM → Service Accounts → Create + JSON key
2. Share properties/sites/containers с SA email
3. Chat: `register_service_account({account_label, json_path, scopes})`
4. `set_default_google_account({label})`

## 9. Acceptance criteria

22 testable items including: pnpm -r build clean, 3 servers visible in /mcp, OAuth flow works for both auth methods, refresh-token automatic, GTM confirm-gate strict, GTM rollback two-step, no secrets in logs, all Cache TTLs verified via cache_stats.

## 10. Risks + mitigations (detailed table — 10 risks)

| Risk | Severity | Mitigation |
|---|---|---|
| Случайный publish чужого GTM container | high | confirm+acknowledge_live+preview |
| Refresh-token отозван silently | medium | classifyGoogleError → re_auth_required |
| Утечка SA JSON в логи | high | redactSecret обёртка + tests |
| GA4 quota exhaustion | medium | Cache 1h + Retry-After |
| ~/.claude.json bloat | low | README раздел |
| Tool name namespace clash | low | Префиксы gsc_/ga4_/gtm_ |
| GTM etag conflict | medium | etag-cache + If-Match + 412 handle |
| Loopback redirect port busy | low | Env override + OOB fallback |
| 3 DBs sync drift | medium | json_path parameter позволяет одним файлом |
| `tagmanager.publish` scope missing → publish fail | medium | Pre-check `scopes_granted` |

## 11. Task breakdown (8 waves, 34 tasks)

См. `task list` в orchestrator.db. IDs TASK-1001 … TASK-1034.

**Wave 1 (parallel-safe, NO user input needed):**
- TASK-1001: skills audit
- TASK-1002: bootstrap 3 pkg shells
- TASK-1003: ENV_PREFIX_MAP + core 0.3.0

**Wave 2 (Google OAuth broker in core):** TASK-1004…1008

**Wave 3 (per-pkg DB + account-resolver):** TASK-1009…1011

**Wave 4 (GSC tools):** TASK-1012…1015

**Wave 5 (GA4 tools):** TASK-1016…1018

**Wave 6 (GTM read):** TASK-1019…1021

**Wave 7 (GTM write + publish + rollback):** TASK-1022…1026

**Wave 8 (servers + smoke + config + docs):** TASK-1027…1034

## 12. User gates expected during execution

- **Gate A** — answer 6 open questions (before Wave 2)
- **Gate B** — provide OAuth Client ID + Secret (after TASK-1011)
- **Gate C** — complete OAuth browser flow (TASK-1011 cont.)
- **Gate D** — confirm GTM target container before first write
- **Gate E** — confirm ~/.claude.json diff before write (TASK-1031)
- **Gate F** — verify all 3 MCPs visible in fresh session
- **Gate G** — user-driven integration smoke (TASK-1034)

## 13. Open questions (BLOCK Wave 2)

1. **Preferred OAuth path первого аккаунта?** user-flow или Service Account
2. **OAuth Client ID уже есть в Google Cloud Console?**
3. **Redirect URI**: loopback (port 8765) или OOB?
4. **Один Google-аккаунт для GSC+GA4+GTM** или разные?
5. **Production GTM containers** — есть ли, что нельзя трогать?
6. **Rollback-preview window**: 60 s или больше?

---

**Estimated:** ~4 200 LOC new, 28 files, 34 tasks, 7 user gates.

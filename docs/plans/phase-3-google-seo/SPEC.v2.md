# SPEC v2: Phase 3 — Google SEO (GSC + GA4 + GTM)

> v2 = v1 + codex round 1 fixes (2 critical + 4 high + 4 medium addressed)

## What's different from v1

| Change | Why |
|---|---|
| Drop OOB OAuth fallback | Google deprecated OOB since 2023-01-31; manual paste-code blocked |
| Cache schema: drop FK on `query_cache.account_id`, add `account_namespace` column | Google account IDs were colliding with Yandex `accounts.id` FK |
| New Wave 0.5 — `getDb()` refactor on package-aware Map | 56 callers blast radius (GitNexus): hidden infra change must be explicit |
| GTM rollback uses DB-persisted `gtm_rollback_plans` table with fingerprint | 60s in-memory race window unsafe — fingerprint re-validation on confirm |
| `acknowledge_live` requires echo of `container_id` / `version_id` | Prevents literal-string cargo-cult across tools |
| OAuth user flow: loopback only, dynamic port (find-free if busy) | OOB removed; hardcoded 8765 was a single point of failure |
| User gates: 7 → 4 | Consolidate workflow fragments; only design-decision gates remain |
| Acceptance criteria: 22 → ~32 | Add migration idempotency, refresh-mutex race, GTM concurrent rollback, scope precheck, secret redaction snapshot |

## 1. Goal (unchanged)

3 sibling packages — `@ohmy-seo/google-search-console` (mcp-gsc), `@ohmy-seo/ga4` (mcp-ga4), `@ohmy-seo/gtm` (mcp-gtm) — shared Google OAuth broker in core, encrypted-at-rest tokens, mirror Phase 2 split pattern. After merge: 6 MCP servers (yandex-seo, mutagen, xmlstock, gsc, ga4, gtm).

## 2. Auth strategy (REVISED — no OOB)

### Two flows supported

**Flow A — Loopback OAuth (machine with browser):**
1. Pkg starts an HTTP listener on `MCP_<PKG>_OAUTH_LOOPBACK_PORT` (default 8765/8766/8767; if busy → find-free)
2. `start_google_oauth_flow` returns auth URL with `redirect_uri=http://127.0.0.1:<port>/oauth/callback` + opaque state
3. User opens URL in browser → grants → Google redirects to localhost → our listener catches code
4. Auto-exchange code → tokens → encrypted save → response to user via stdio: "ok, account linked"
5. Listener auto-shutdown after first callback OR 5-minute TTL

**Flow B — Service Account (headless / agencies):**
1. User creates SA in Google Cloud Console, gets JSON file
2. User shares Search Console properties / GA4 properties / GTM containers with SA email (with right roles — Owner for Indexing API per audit F-01)
3. `register_service_account({account_label, json_path, scopes})` reads abs path, AES-GCM-encrypts the JSON, stores in `google_accounts.service_account_json_enc`. **Original JSON file untouched** (user can move/delete it after register).
4. Each API call: token-broker pulls SA JSON → signs RS256 JWT → exchanges for access token (cached in `expires_at`).

### NO OOB

OOB (`urn:ietf:wg:oauth:2.0:oob` or manual paste-code) is **deprecated by Google since 2023-01-31** and no longer works for new OAuth clients. SPEC v2 removes all references.

## 3. Database schema (REVISED)

### Migration V4 (applied to ALL package DBs via core's `getDb()` lazy migration)

```sql
-- Patch existing query_cache: drop FK, add namespace column
-- NOTE: SQLite doesn't support DROP CONSTRAINT — need full table rebuild.
-- Migration steps:
--   1. CREATE TABLE query_cache_v4 (no FK, with account_namespace)
--   2. INSERT INTO query_cache_v4 SELECT *, 'yandex' FROM query_cache WHERE account_id IS NOT NULL UNION ALL SELECT *, NULL FROM query_cache WHERE account_id IS NULL
--   3. DROP TABLE query_cache
--   4. ALTER TABLE query_cache_v4 RENAME TO query_cache
--   5. Recreate indexes including UNIQUE (tool, account_namespace, account_id, args_hash)

CREATE TABLE IF NOT EXISTS query_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool TEXT NOT NULL,
  account_namespace TEXT,           -- 'yandex' | 'google' | NULL for global
  account_id INTEGER,                -- soft-ref to {namespace}_accounts.id
  args_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (tool, account_namespace, account_id, args_hash)
);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);

-- Google OAuth tables
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

-- GTM rollback plans (DB-backed race-safe)
CREATE TABLE IF NOT EXISTS gtm_rollback_plans (
  id TEXT PRIMARY KEY,                   -- UUID
  account_id INTEGER NOT NULL,           -- google_accounts.id
  gtm_account_id TEXT NOT NULL,          -- GTM API accountId
  container_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  from_version_id TEXT NOT NULL,         -- "live" at time of preview
  to_version_id TEXT NOT NULL,           -- target old version
  fingerprint TEXT NOT NULL,             -- GTM container fingerprint at preview time
  expires_at INTEGER NOT NULL,           -- preview + 5min (was 60s — bumped per codex)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gtm_rollback_plans_expires ON gtm_rollback_plans(expires_at);
```

**Migration is idempotent.** Re-running on already-migrated DB is a no-op (CREATE IF NOT EXISTS, conditional column check).

## 4. `getDb()` refactor (NEW WAVE 0.5 — replaces TASK-1003B)

### Current state (problematic)

```ts
// packages/core/src/db/connection.ts (current)
let _db: Database;
export function getDb(): Database {
  if (!_db) {
    const path = process.env.MCP_YANDEX_SEO_DB_PATH;  // ← HARDCODED yandex
    _db = new Database(path);
    applyMigrations(_db);
  }
  return _db;
}
```

GitNexus impact: 56 symbols, 25 callers, 14 process flows.

### Target state (package-aware)

```ts
// packages/core/src/db/connection.ts (v2)
import { resolvePackageConfig } from '../config/package-config.js';

const _dbCache = new Map<string, Database>();

export function getDb(packageName?: string): Database {
  const pkg = packageName ?? inferCallerPackage();  // back-compat: yandex-seo as default
  if (!_dbCache.has(pkg)) {
    const cfg = resolvePackageConfig(pkg);
    const db = new Database(cfg.dbPath);
    applyMigrations(db);  // idempotent — applies V1..V4 as needed
    _dbCache.set(pkg, db);
  }
  return _dbCache.get(pkg)!;
}

// Back-compat: zero-arg getDb() falls back to yandex-seo
// (existing code keeps working without changes)
function inferCallerPackage(): string {
  return 'yandex-seo';  // legacy default
}
```

**Back-compat guarantee:** `getDb()` (no args) returns the yandex-seo DB exactly as before. New callers pass `getDb('google-search-console')` etc.

### Migration of callers in 3 new packages

Each new pkg calls `getDb(pkg.name)` explicitly. Yandex/mutagen/xmlstock untouched.

## 5. Architecture decisions (unchanged from v1 except as noted)

- **OAuth broker in `@ohmy-seo/mcp-core/google-oauth/`** — shared by all 3 sibling pkgs. Bump core 0.3.0 → 0.4.0.
- **Per-package DBs** — service/cache isolation. Account linking 3 times accepted (mitigated by SA `json_path` for headless).
- **Cache TTL per tool** — unchanged from v1.
- **GTM write safety** — `confirm: true` default-false, dry-run preview. Publish + rollback also require `acknowledge_live` echoing target ID.
- **File-line budgets** — unchanged.

## 6. GTM rollback two-step (REVISED)

### Step 1: Preview (read-only, no API write)

```
gtm_rollback({
  account: <label>,
  container_id: 'GTM-XXXXX',
  workspace_id: '7',
  to_version_id: '15',           // target old version
  confirm: false                  // default
})
```

→ Tool reads live GTM state:
- Get current live version via `versions:live`
- Fetch target version via `versions/{id}`
- Compute container fingerprint
- Generate `rollback_plan_id` (UUID)
- INSERT INTO `gtm_rollback_plans` (id, account_id, gtm_account_id, container_id, workspace_id, from_version_id, to_version_id, fingerprint, expires_at=now+5min)
- Return:
  ```json
  {
    "dry_run": true,
    "plan_id": "uuid-xxxxx",
    "expires_at": "2026-05-18T20:05:00Z",
    "preview": {
      "from_version": "16 (live, fingerprint: abc...)",
      "to_version": "15",
      "fingerprint_at_preview": "abc...",
      "warning": "Rollback will publish version 15 as new live. Tags X, Y, Z will change."
    },
    "next_step": "Within 5 min, call gtm_rollback with the SAME args + plan_id + confirm:true + acknowledge_live:'I-UNDERSTAND-THIS-IS-LIVE:GTM-XXXXX'"
  }
  ```

### Step 2: Execute (write, gated)

```
gtm_rollback({
  account: <label>,
  container_id: 'GTM-XXXXX',
  workspace_id: '7',
  to_version_id: '15',
  plan_id: 'uuid-xxxxx',
  confirm: true,
  acknowledge_live: 'I-UNDERSTAND-THIS-IS-LIVE:GTM-XXXXX'
})
```

→ Tool:
1. SELECT plan FROM `gtm_rollback_plans` WHERE id=plan_id AND expires_at>now → if missing/expired: 400 "Plan expired or not found"
2. Verify args match plan (account/container/workspace/to_version)
3. **Re-fetch live state** — get current live version + fingerprint
4. If `current_fingerprint !== plan.fingerprint_at_preview` → 409 "Concurrent edit detected, re-run preview"
5. Execute: `versions/{to_version}:create_version_from_old` → get new version → `versions/{new}:publish`
6. DELETE plan (single-use)

### Concurrent session safety

Two sessions running `gtm_rollback` preview at the same time:
- Both INSERT separate plans with distinct UUIDs — no conflict
- Session A confirms first → live state changes → fingerprint mismatch detected
- Session B's confirm now fails with 409 (its plan.fingerprint != current fingerprint)
- B must re-run preview if they still want to rollback

## 7. acknowledge_live target-bound (REVISED)

Old: `acknowledge_live: 'I-UNDERSTAND-THIS-IS-LIVE'` (literal)

**New:** for `gtm_publish_version` and `gtm_rollback`, must include target ID:
- `gtm_publish_version`: `acknowledge_live: 'I-UNDERSTAND-THIS-IS-LIVE:<version_id>'`
- `gtm_rollback`: `acknowledge_live: 'I-UNDERSTAND-THIS-IS-LIVE:<container_id>'`

This prevents copy-paste between contexts (e.g. user accidentally reusing string from earlier session to publish wrong version).

## 8. Acceptance criteria (EXPANDED — 32 items)

### Core
1. `pnpm -r build` clean (all 7 packages compile)
2. `pnpm --filter @ohmy-seo/mcp-core build` exits 0
3. `@ohmy-seo/mcp-core@0.4.0` (bumped for google-oauth + getDb refactor)
4. `getDb()` (no args) returns Yandex DB unchanged — back-compat
5. `getDb('google-search-console')` returns separate DB instance
6. `getDb('ga4')` returns separate DB instance
7. `getDb('gtm')` returns separate DB instance
8. Migration V4 idempotent — running twice does not fail or duplicate data
9. `yandex-seo` cache smoke 5/5 PASS (regression check)
10. `mutagen` + `xmlstock` cache smokes still pass

### OAuth broker
11. `getGoogleAccessToken(account, app?)` works for both `auth_method`
12. Token refresh threshold: refresh starts at `expires_at - 300s`
13. Refresh mutex: 2 concurrent calls to `getGoogleAccessToken` for same accountId → only 1 actual refresh HTTP call (mutex assertion)
14. `invalid_grant` from Google → classifyGoogleError returns `re_auth_required: true`
15. Service Account JSON encrypted-at-rest, **never** logged or returned naked

### Per-pkg
16. `mcp-gsc` registers 16 tools (9 oauth + 4 read + 3 write)
17. `mcp-ga4` registers 17 tools (9 oauth + 4 read + 4 report)
18. `mcp-gtm` registers 27 tools (9 oauth + 8 read + 4 write + 2 etag + 1 version + 2 DANGER + 2 cache)
19. `mcp-ga4::ga4_run_realtime_report` NOT in CACHEABLE_TOOLS
20. `mcp-gsc::gsc_indexing_publish` description mentions Owner role + 200/day quota (audit F-01/F-02)
21. `mcp-ga4::ga4_list_conversion_events` uses `/keyEvents` endpoint (audit F-03)

### GTM safety
22. `gtm_*` write tools default `confirm: false` returns dry-run, no API call
23. `gtm_publish_version` requires `acknowledge_live: 'I-UNDERSTAND-THIS-IS-LIVE:<version_id>'`
24. `gtm_publish_version` pre-checks `scopes_granted` contains `tagmanager.publish` before any HTTP call
25. `gtm_rollback` two-step: preview creates plan, confirm validates fingerprint
26. Concurrent rollback test: 2 plans with same target → confirm A succeeds, confirm B returns 409 fingerprint mismatch
27. Rollback plan expires after 5 min (TTL enforced)

### Config & docs
28. `~/.claude.json` adds 3 entries (mcp-gsc, mcp-ga4, mcp-gtm) without touching existing 4
29. Backup `~/.claude.json.bak.<ts>` created before write
30. README mentions all 3 new packages + OAuth setup links
31. 4 Google skills get audit fixes applied (F-01/F-02/F-03)
32. **Secret redaction snapshot:** stderr/log capture during refresh + register_service_account contains zero matches for known secret patterns

## 9. User gates (CONSOLIDATED — 4 instead of 7)

| Gate | When | What |
|---|---|---|
| **G-Auth** | After Wave 3 (oauth-mgmt tools ready) | User creates OAuth Client ID OR Service Account JSON in Google Cloud Console, runs `register_google_oauth_app` OR `register_service_account` |
| **G-Config** | After TASK-1031 | User reviews `~/.claude.json` diff before confirm |
| **G-Restart** | After TASK-1032 | User restarts Claude Code, confirms all 6 MCPs visible in fresh `/mcp` |
| **G-Smoke** | After TASK-1033 | User runs live integration smoke (GSC list_sites + GA4 list_properties + GTM dry-run create_tag) |

## 10. Task graph (REVISED)

### Wave 0.5 (NEW — Critical infra)
- **TASK-1003B** — `getDb()` refactor on package-aware Map. CRITICAL risk class. Replaces hidden gap in TASK-1003.

### Wave 2 (Google OAuth in core) — REVISED
- **TASK-1004** (rewritten) — Migration V4: cache-FK drop + namespace + google_oauth_apps + google_accounts + gtm_rollback_plans
- TASK-1005 — scope constants (already running)
- **TASK-1006** (revised) — oauth-user-flow: loopback only (no OOB), dynamic port, state-CSRF validation
- TASK-1007 — service-account-flow (unchanged)
- **TASK-1008** (revised) — token-broker: per-accountId mutex (race-safe), classifyGoogleError includes re_auth_required

### Waves 3-8 — mostly unchanged from v1 except:
- TASK-1022 (confirm-gate) — adds target-bound acknowledge_live helper
- TASK-1026 (DANGER tools) — rollback uses gtm_rollback_plans table + fingerprint re-validation

### Wave 8.5 (NEW — Verification)
- **TASK-1034B** — Concurrency tests: refresh-mutex race + GTM concurrent rollback simulation

## 11. Risks + mitigations (extended)

Unchanged from v1 + new entries:

| Risk | Mitigation |
|---|---|
| **getDb() refactor breaks yandex-seo** | Back-compat: zero-arg getDb() defaults to 'yandex-seo'. Smoke verified before continuing. |
| **V4 migration corrupts query_cache during ALTER** | SQLite transaction wrap entire V4 migration. Idempotency via CREATE IF NOT EXISTS. Pre-backup recommended (auto-backup `state.db.bak.v3` before V4 apply). |
| **Loopback port busy / firewalled** | Dynamic port: try preferred → find-free. If all blocked → fail with clear message "OAuth setup requires local browser; use Service Account flow for headless environments." |
| **Rollback plan_id leaked between sessions** | plan_id is UUID, not enumerable. account_id + acknowledge_live target-bound prevents cross-session abuse. |
| **GTM container fingerprint changes between preview and confirm** | This is the FEATURE. 409 with "concurrent edit" message + suggest re-run preview. |
| **Secret leak via stderr during refresh** | redactSecret wrapper around any logged response. Acceptance #32 snapshots stderr to verify zero matches. |

## 12. Estimated cost

- **LOC:** ~4 500 (was 4 200; +300 for migration+rollback persistence+mutex tests)
- **Tasks:** **36** (34 v1 + TASK-1003B getDb + TASK-1034B concurrency tests)
- **User gates:** 4 (was 7)
- **Phases:** 8.5 waves

## 13. NOT in scope (unchanged)

YouTube / Threads / BigQuery / Lighthouse / GBP / GTM Server-side / Workspace domain-wide delegation.

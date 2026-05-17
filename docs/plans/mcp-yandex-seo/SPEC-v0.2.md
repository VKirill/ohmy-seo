# SPEC: mcp-yandex-seo v0.2 — Multi-account + OAuth flow + SQLite

Дата: 2026-05-17. Базируется на ROADMAP.md (зафиксированные архитектурные решения).
Предыдущая версия: v0.1.0 (single token из env, 7 read-only tools).
Это **breaking** релиз — env vars `YANDEX_OAUTH_TOKEN`, `WEBMASTER_USER_ID`,
`METRIKA_COUNTER_ID`, `DIRECT_CLIENT_LOGIN` удаляются.

## Goal

Превратить single-token MCP в multi-account/multi-OAuth-app сервер. Пользователь
регистрирует одну или несколько OAuth-app записей (`client_id` + `client_secret`),
проходит Authorization Code flow с OOB redirect для каждого Яндекс-аккаунта,
получает несколько подключённых `accounts` под разными scope. Любой из 7 доменных
tools принимает опциональный параметр `account` (label) и резолвится через
token-broker (с авторефрешем access_token). Состояние хранится в локальной SQLite
с шифрованием секретов AES-256-GCM.

## Non-goals (v0.2)

- Inventory cache (`list_sites`, `find_property`, `list_counters`) — это v0.3.
- Query result cache (Wordstat/Mutagen TTL) — это v0.4.
- OS keychain (`keytar`) — это v0.5.
- Fuzzy/typo-tolerant resolver для account label — точное совпадение.
- HTTP/SSE-транспорт. Только stdio.
- Web UI для подключения. Только CLI/MCP-tool flow.
- Backwards-compat shim для env vars v0.1 (см. ROADMAP п.3 — breaking).
- Параллельные refresh-вызовы одного `refresh_token` без mutex — оставляем mutex per-account.
- Audit log таблица `oauth_events` — это v0.5.
- Direct sandbox per-account — флаг `DIRECT_USE_SANDBOX` остаётся глобальным env.

## Acceptance criteria

- [ ] `npm run build` зелёный, `tsc --noEmit` без ошибок.
- [ ] Старт сервера БЕЗ `MCP_YANDEX_SEO_MASTER_KEY` (или с невалидным значением) → fatal exit с инструкцией `openssl rand -hex 32` в stderr; код выхода 1.
- [ ] Старт сервера с валидным master key создаёт `data/state.db` (mode 0600) если его не было, миграция применяется идемпотентно.
- [ ] 15 tools зарегистрированы: 8 oauth-management + 7 доменных (с опц. `account`).
- [ ] `register_oauth_app` сохраняет шифрованный `client_secret`, plaintext в БД отсутствует.
- [ ] `start_oauth_flow` возвращает корректный authorize URL вида `https://oauth.yandex.ru/authorize?response_type=code&client_id=...&redirect_uri=https%3A%2F%2Foauth.yandex.ru%2Fverification_code`.
- [ ] `complete_oauth_flow` меняет 7-симв. код на access+refresh tokens, сохраняет шифрованные с `expires_at`, заполняет `scopes_granted` и (если получится) `yandex_login` через probe-call на `https://login.yandex.ru/info`.
- [ ] Token broker отдаёт свежий access_token: если `expires_at - now < 300s` — refresh; иначе из БД. Concurrent refresh на один account-id защищён mutex (in-process Map).
- [ ] Любой из 7 доменных tools работает с `account: "label"` и без него (резолвится через is_default или единственного кандидата).
- [ ] При отсутствии подходящих accounts с нужным scope tool возвращает `isError:true` с массивом доступных account labels и подсказкой подключить.
- [ ] `delete_oauth_app` отказывается удалять app, если есть привязанные accounts (вернёт список account labels).
- [ ] `set_default_account` снимает флаг с предыдущего default и ставит на нового (атомарно в одной транзакции).
- [ ] Sanitizer ловит client_secret и refresh_token в случайном stderr-выводе (regex покрывает оба паттерна).
- [ ] `.env.example` содержит `MCP_YANDEX_SEO_MASTER_KEY` с однострочной инструкцией; не содержит удалённых ключей.
- [ ] `.gitignore` содержит `data/`, `data/state.db*`, `.env`.
- [ ] Удалены: `src/lib/yandex-oauth.ts` (старый плоский хелпер), `getDefaultCounterId`, `getUserId`, `WEBMASTER_USER_ID`/`METRIKA_COUNTER_ID`/`DIRECT_CLIENT_LOGIN` reads.
- [ ] README v0.2 описывает: master key → register app → start flow → complete flow → use tool.
- [ ] Не существует кодовых путей, где access_token / refresh_token / client_secret попадает в строку, передаваемую модели (audit grep против `access_token`, `refresh_token`, `client_secret` в финальных tool response).

## Architecture decisions

- **БД-движок: `better-sqlite3@^11`.** Синхронный API — это плюс для in-process MCP (нет race с async tx, проще mutex). Нативная компиляция через node-gyp при первом `npm install` (~30 сек на средней машине). Альтернатива `node:sqlite` (Node 22+) отклонена — слишком молода, prepared statements менее эргономичны.
- **Master-key fail-fast.** Невалидный/отсутствующий master key — fatal exit на старте, до любых других проверок. Никаких "запустим в read-only режиме без БД" — это даст путаную диагностику.
- **Шифрование per-cell.** Каждая зашифрованная ячейка хранит `iv(12) || ciphertext || authTag(16)` как `BLOB`. IV генерируется случайно при каждой записи. AAD не используется — единственный ключ, никаких контекстных привязок.
- **OOB redirect жёстко зашит.** `redirect_uri=https://oauth.yandex.ru/verification_code` — не параметризуем. Это часть OAuth flow, не точка кастомизации.
- **Token broker — mutex per-account.** `Map<accountId, Promise<string>>`. Параллельный вызов `getAccessToken(42)` на свежий expired token не должен выстреливать в Яндекс двумя refresh-запросами (второй вернёт `invalid_grant` если refresh-токен ротируется).
- **Refresh-token rotation.** Яндекс OAuth ротирует refresh_token при каждом use. После успешного refresh новые `access_token` + `refresh_token` пишутся в одну UPDATE-транзакцию.
- **Direct routing внутри tools, не в broker.** Broker не знает про scope-семантику. `resolveAccount(scope, explicitLabel?)` — отдельный модуль (`account-resolver.ts`), вызывается из доменных tools перед broker.
- **Annotations: `readOnlyHint: true` для всех.** Локальная БД мутация (registration, token storage) — это инфраструктура MCP, не внешний мир. `readOnlyHint` относится к внешним эффектам по спецификации MCP.
- **Zod v4: `error` параметр вместо `errorMap`.** В custom validators используем `z.string().refine(..., { error: () => "msg" })`.
- **Schema dialect остаётся draft-07** (SDK 1.29 default). Никаких принудительных override.
- **Никаких retry с экспоненциальным backoff в v0.2.** Только пройти refresh цикл + один retry оригинального запроса с новым токеном при 401, если broker считал токен валидным.

## Data model (SQLite)

Файл: `data/state.db` (relative to project cwd, override через `MCP_YANDEX_SEO_DB_PATH`).
Права: `chmod 0600` сразу после создания.

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc BLOB NOT NULL,
  scopes_declared TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT UNIQUE NOT NULL,
  oauth_app_id INTEGER NOT NULL REFERENCES oauth_apps(id) ON DELETE RESTRICT,
  yandex_login TEXT,
  webmaster_user_id INTEGER,
  access_token_enc BLOB NOT NULL,
  refresh_token_enc BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  scopes_granted TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_default ON accounts(is_default) WHERE is_default = 1;
```

Inventory tables (`inv_sites`, `inv_counters`, `inv_direct_clients`) и `query_cache` —
**не v0.2**, не создаём миграцию заранее.

## File plan (with budgets + responsibility)

| File | New/Modified | Target | Hard cap | Responsibility |
|---|---|---|---|---|
| `src/lib/db/connection.ts` | New | ~70 | 150 | Open SQLite DB at resolved path with 0600 perms, apply pragmas, return Database singleton |
| `src/lib/db/migrations.ts` | New | ~80 | 150 | Apply ordered SQL migrations, record in schema_version |
| `src/lib/db/oauth-apps-repo.ts` | New | ~120 | 200 | CRUD over oauth_apps |
| `src/lib/db/accounts-repo.ts` | New | ~180 | 250 | CRUD over accounts |
| `src/lib/crypto/master-key.ts` | New | ~50 | 100 | Read MCP_YANDEX_SEO_MASTER_KEY, validate, fail-fast |
| `src/lib/crypto/secret-cipher.ts` | New | ~70 | 120 | AES-256-GCM encrypt/decrypt |
| `src/lib/oauth/yandex-flow.ts` | New | ~140 | 220 | buildAuthorizeUrl, exchangeCode, refreshAccessToken |
| `src/lib/oauth/login-probe.ts` | New | ~40 | 80 | Best-effort probe login.yandex.ru/info + webmaster /v4/user |
| `src/lib/oauth/token-broker.ts` | New | ~120 | 200 | getAccessToken with mutex + refresh-on-near-expiry |
| `src/lib/account-resolver.ts` | New | ~110 | 180 | Resolve account by (explicit \| default \| sole candidate) |
| `src/lib/scopes.ts` | New | ~40 | 80 | Scope constants, hasScope helper, REQUIRED_SCOPE_BY_TOOL |
| `src/lib/errors.ts` | Modified | +30 | 350 | Add OAuthFlowError, AccountNotFoundError, NoMatchingAccountError; sanitizer regex extends |
| `src/lib/http.ts` | Modified | +5 | 150 | UA bump |
| `src/lib/webmaster-client.ts` | Modified | +30/-25 | 250 | Accept accountId; use broker; use accounts.webmaster_user_id |
| `src/lib/metrika-client.ts` | Modified | +20/-20 | 250 | Accept accountId + counterId required from input |
| `src/lib/direct-client.ts` | Modified | +25/-20 | 250 | Accept accountId; optional client_login per-call |
| `src/tools/webmaster-*.ts` (×3) | Modified | +15/-5 each | 150 | Resolve account, call client |
| `src/tools/metrika-*.ts` (×2) | Modified | +15/-5 each | 150 | Same; counter_id now required input |
| `src/tools/wordstat-keywords.ts` | Modified | +20/-5 | 150 | Resolve direct-scope account |
| `src/tools/mutagen-competition.ts` | Modified | 0 | 150 | Unchanged |
| `src/tools/oauth-list-apps.ts` | New | ~30 | 80 | List oauth_apps (без secrets) |
| `src/tools/oauth-register-app.ts` | New | ~50 | 100 | Validate, encrypt, insert |
| `src/tools/oauth-delete-app.ts` | New | ~40 | 100 | Delete with FK guard |
| `src/tools/oauth-list-accounts.ts` | New | ~40 | 100 | List joined (без tokens) |
| `src/tools/oauth-start-flow.ts` | New | ~50 | 100 | Build authorize URL |
| `src/tools/oauth-complete-flow.ts` | New | ~80 | 150 | Exchange code → tokens → probe → insert |
| `src/tools/oauth-delete-account.ts` | New | ~40 | 100 | Delete by label |
| `src/tools/oauth-set-default-account.ts` | New | ~40 | 100 | Atomic default transition |
| `src/index.ts` | Modified | +180/-20 | 380 | Register 8 new + modify 7 existing |
| `src/lib/yandex-oauth.ts` | **Deleted** | -25 | — | Replaced by token-broker + scopes |
| `src/smoke.ts` | Modified | +50/-30 | 350 | Use account-resolver, seed test app/account from SMOKE_* env |
| `.env.example` | Modified | rewrite | — | master key, MUTAGEN_API_KEY, DIRECT_USE_SANDBOX, HTTP_TIMEOUT_MS, MCP_YANDEX_SEO_DB_PATH |
| `README.md` | Modified | rewrite | 400 | v0.2 quickstart |
| `package.json` | Modified | +2 deps | — | better-sqlite3, @types/better-sqlite3; version 0.2.0 |

**Forecast total v0.2 delta:** ~1100 LOC new + ~500 LOC modified, ~100 LOC removed. Repository total after v0.2 ≈ 2700 LOC.

## Tools v0.2 — input schemas (pseudocode)

All annotations: `{ readOnlyHint: true, openWorldHint: true, idempotentHint: false }`.

### OAuth management (8 new)

```ts
list_oauth_apps()  // input: {}
register_oauth_app({label, client_id, client_secret, scopes_declared})
delete_oauth_app({label})
list_accounts()
start_oauth_flow({app_label, account_label})  // returns authorize URL
complete_oauth_flow({account_label, code})    // exchange + save
delete_account({label})
set_default_account({label})
```

### Domain tools (7 modified)

All 7 add optional `account: z.string().min(1).optional()`. `counter_id` теперь strictly required from input (no env fallback). Webmaster user_id берётся из `accounts.webmaster_user_id` (probed at complete_oauth_flow time). Each tool calls `resolveAccount(REQUIRED_SCOPE_BY_TOOL[name], input.account)` перед client.

## Removed (breaking)

- `src/lib/yandex-oauth.ts` (deleted)
- Env vars: `YANDEX_OAUTH_TOKEN`, `WEBMASTER_USER_ID`, `METRIKA_COUNTER_ID`, `DIRECT_CLIENT_LOGIN`
- Functions: `getDefaultCounterId()`, `getUserId()`

## Dependencies

- Add: `better-sqlite3@^11.7.0`, `@types/better-sqlite3@^7.6.12`.
- README must document `python3` + C++ toolchain prerequisite (already present on most dev machines).

## Risks & mitigation

1. **Master key compromise (filesystem read).** Если атакующий читает `.env` + `data/state.db` — получает все токены.  
   *Mitigation v0.2:* документировать хранение master key вне репо (рекомендуем shell rc env), `chmod 0600` enforced, key никогда не логируется. v0.5: keychain.

2. **Concurrent refresh race (token rotation).** Яндекс ротирует refresh_token; два параллельных refresh выпиливают второй (`invalid_grant`) и брикуют аккаунт.  
   *Mitigation:* in-process `Map<accountId, Promise>` mutex в token-broker. Тесты покрывают concurrent calls.

3. **Refresh-token revocation by user.** Юзер отзывает доступ в oauth.yandex.ru/authorized-clients/. Следующий refresh падает.  
   *Mitigation:* `OAuthFlowError` → понятное сообщение "Refresh failed for account 'X'. Re-run start_oauth_flow." Row остаётся, юзер ре-линкует тот же label.

4. **Token leak через stderr / crash dump.** Любая несанитайзеная log-строка с токеном течёт.  
   *Mitigation:* extend `sanitizeForOutput` для `"access_token":...`, `"refresh_token":...`, `client_secret=...`. Audit grep на финальных response.

5. **SQLite файл случайно закоммичен.** `data/state.db` могут добавить `git add .`.  
   *Mitigation:* `.gitignore` entry `data/` + smoke asserts `git check-ignore data/state.db`.

6. **Label collision на start_oauth_flow.**  
   *Mitigation:* start_oauth_flow проверяет что label свободен; complete делает INSERT (не UPDATE).

7. **Native build first-install.**  
   *Mitigation:* README документирует prerequisites.

8. **JSON Schema dialect drift.** Не блокер в v0.2.

## Out of scope (explicit)

- Inventory caching tools — v0.3.
- Query result caching with TTL — v0.4.
- `keytar` / OS keychain — v0.5.
- `oauth_events` audit log — v0.5.
- Fuzzy resolver / typo suggestions.
- Multi-tenant / per-user DB isolation.

## Decomposition into atomic tasks

12 atomic tasks, all `worker-coder`. Each task ends green (`npm run build` + targeted grep checks).

**Critical path:**  
101 → 102 → 103 → 104 → 105 → 106 → 107 → (108 ‖ 109) → 110 → 111 → 112

### TASK-101 — Bootstrap deps, master-key, fail-fast
**Files:** `package.json`, `src/lib/crypto/master-key.ts` (new), `src/index.ts` (modified), `.env.example` (rewrite), `.gitignore` (add `data/`).  
**Risk:** low. **Deps:** none.

### TASK-102 — Crypto primitives (AES-256-GCM)
**Files:** `src/lib/crypto/secret-cipher.ts` (new).  
**Risk:** low. **Deps:** TASK-101.

### TASK-103 — DB connection + migrations
**Files:** `src/lib/db/connection.ts` (new), `src/lib/db/migrations.ts` (new).  
**Risk:** medium (file perms cross-platform). **Deps:** TASK-101.

### TASK-104 — Repos: oauth_apps + accounts
**Files:** `src/lib/db/oauth-apps-repo.ts` (new), `src/lib/db/accounts-repo.ts` (new).  
**Risk:** medium. **Deps:** TASK-102, TASK-103.

### TASK-105 — Yandex OAuth HTTP flow
**Files:** `src/lib/oauth/yandex-flow.ts` (new), `src/lib/oauth/login-probe.ts` (new).  
**Risk:** medium (auth header format). **Deps:** TASK-101.

### TASK-106 — Token broker + scope helpers
**Files:** `src/lib/scopes.ts` (new), `src/lib/oauth/token-broker.ts` (new).  
**Risk:** high (race conditions). **Deps:** TASK-104, TASK-105.

### TASK-107 — Account resolver
**Files:** `src/lib/account-resolver.ts` (new), `src/lib/errors.ts` (modified).  
**Risk:** low. **Deps:** TASK-104, TASK-106.

### TASK-108 — Wire OAuth-management tools (8 new)
**Files:** 8 new tool files; `src/index.ts` (modified).  
**Risk:** medium. **Deps:** TASK-104, TASK-105.

### TASK-109 — Refactor 6 domain tools (webmaster + metrika + wordstat)
**Files:** 3 lib clients (modified), 6 tool wrappers (modified), `src/lib/scopes.ts`.  
**Risk:** medium. **Deps:** TASK-106, TASK-107.

### TASK-110 — Delete old yandex-oauth.ts + sanitizer extension
**Files:** `src/lib/yandex-oauth.ts` (deleted), `src/lib/errors.ts` (modified).  
**Risk:** low. **Deps:** TASK-109.

### TASK-111 — Smoke test refactor + README v0.2
**Files:** `src/smoke.ts` (modified), `README.md` (rewrite).  
**Risk:** low. **Deps:** TASK-108, TASK-109, TASK-110.

### TASK-112 — Final acceptance review + secret-leak audit
**Files:** none (verification only).  
**Risk:** low. **Deps:** TASK-111.

## Open questions (implementation-time, not blockers)

1. Yandex `/token` Basic auth vs form-body для client credentials — оба поддерживаются. Идём с Basic, fallback на form-body если сломается на реальных вызовах в TASK-105.
2. `webmaster_user_id` probe: `GET /v4/user/` возвращает `{user_id}`. Если probe падает в complete_oauth_flow, аккаунт сохраняется, но webmaster tools будут падать до повторного complete.
3. Direct `Client-Login` header — required только для агентских аккаунтов. Делаем optional per-call.

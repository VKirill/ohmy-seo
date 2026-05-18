# SPEC: ohmy-seo monorepo — Phase 1

## Overview

Convert single repo `mcp-yandex-seo` into pnpm workspace `ohmy-seo` hosting two packages: `@ohmy-seo/mcp-core` (stack-agnostic infra — cache, sqlite, http, errors, encryption) and `@ohmy-seo/yandex-seo` (existing 19-tool MCP server, now consuming core via workspace imports). Goal: zero functional regressions, 4 OAuth accounts intact in `data/state.db`, Claude Code MCP registration continues to work under original server name `mcp-yandex-seo`.

## Roadmap

- **Phase 1 (this SPEC):** monorepo skeleton + core extraction + yandex-seo migration. GitHub repo rename. Mutagen stays inside yandex-seo for now.
- **Phase 2 (future):** extract Mutagen out of yandex-seo into new `@ohmy-seo/seo-parsers` package; add XMLStock; yandex-seo drops to 17 tools (v0.7.0 breaking); new `mcp-seo-parsers` MCP server.
- **Phase 3 (future):** new `@ohmy-seo/google-seo` package — Google service account JWT auth, GSC v3 + GA4 Data API v1beta generic gateways; new `mcp-google-seo` MCP server.

## Resolved decisions

| Question | Decision | Rationale |
|---|---|---|
| Token-broker seam in Phase 1? | **No, stays in yandex-seo** | YAGNI — Google (Phase 3) is when we'll actually need the generic broker. Phase 1 keeps logic completely unchanged. |
| pnpm version | **pnpm@9** via `packageManager` field | LTS, stable, no surprises |
| `data/` directory location | **Keep `packages/yandex-seo/data/`** | Matches current convention, minimal code edits |
| GitHub repo rename | **Yes, A — `gh repo rename`** | User pre-approved |
| npm scope | **`@ohmy-seo`** | User pre-approved; workspace-only, never published |

## Phase 1 acceptance criteria

- [ ] Repo dir renamed: `/home/ubuntu/tools/mcp-yandex-seo/` → `/home/ubuntu/tools/ohmy-seo/`
- [ ] GitHub remote renamed: `VKirill/mcp-yandex-seo` → `VKirill/ohmy-seo` via `gh repo rename`
- [ ] Git history preserved (every move via `git mv`, no fresh repo)
- [ ] Root `package.json`: `{ "name": "ohmy-seo", "private": true, "packageManager": "pnpm@9.x" }`
- [ ] `pnpm-workspace.yaml` declares `packages/*`
- [ ] `tsconfig.base.json` at root; each package extends it
- [ ] `packages/core/` builds as `@ohmy-seo/mcp-core`
- [ ] `packages/yandex-seo/` builds, imports from `@ohmy-seo/mcp-core` via `workspace:*`
- [ ] `pnpm install` resolves links; `pnpm -r build` exits 0
- [ ] Claude Code MCP entry (`mcp-yandex-seo`) updated: `command`/`args` paths; server-name string unchanged
- [ ] Smoke: `list_accounts` from Claude Code returns 4 accounts (production tokens intact, decryption works under existing `MCP_YANDEX_SEO_MASTER_KEY`)
- [ ] All 19 tools registered and respond
- [ ] `data/state.db` + `.env` physically inside `packages/yandex-seo/`, byte-identical
- [ ] Commit + push to renamed remote on `main`

**Out of scope:** Mutagen extraction, logic refactors, dependency upgrades, test additions, npm publishing.

## File-by-file migration

Source paths relative to `/home/ubuntu/tools/mcp-yandex-seo/`. Destinations relative to `/home/ubuntu/tools/ohmy-seo/`.

### Root-level

| Source | Destination | Action |
|---|---|---|
| `package.json` | `packages/yandex-seo/package.json` | move + rewrite name → `@ohmy-seo/yandex-seo`, add `@ohmy-seo/mcp-core: workspace:*` |
| — | `package.json` (root) | NEW — workspace metadata |
| `tsconfig.json` | `packages/yandex-seo/tsconfig.json` | move + rewrite (`extends: ../../tsconfig.base.json`) |
| — | `tsconfig.base.json` (root) | NEW — shared compiler opts |
| `.env` | `packages/yandex-seo/.env` | move as-is (byte-identical) |
| `.gitignore` | root `.gitignore` | stays — verify covers both packages |
| `data/state.db` (+wal/shm) | `packages/yandex-seo/data/` | move as-is, NOT re-encrypted |
| `README.md` | root `README.md` | rewrite (monorepo overview) |
| — | `packages/yandex-seo/README.md` | NEW (copy of old, with note) |
| `node_modules/` | (delete) | re-installed by `pnpm install` |
| `dist/` | (delete) | rebuilt per package |
| `scripts/` | `packages/yandex-seo/scripts/` | move as-is |

### `src/lib/` → `@ohmy-seo/mcp-core` (move to `packages/core/src/`)

All moves are **as-is** — file bodies unchanged except import-path rewrites between moved files.

| Source | Destination |
|---|---|
| `src/lib/crypto/*.ts` | `packages/core/src/crypto/*.ts` |
| `src/lib/http.ts` | `packages/core/src/http.ts` |
| `src/lib/errors.ts` | `packages/core/src/errors.ts` |
| `src/lib/db/connection.ts` | `packages/core/src/db/connection.ts` |
| `src/lib/db/migrations.ts` | `packages/core/src/db/migrations.ts` |
| `src/lib/cache/cache-keys.ts` | `packages/core/src/cache/cache-keys.ts` |
| `src/lib/cache/cache-policy.ts` | `packages/core/src/cache/cache-policy.ts` |
| `src/lib/cache/cache-stats.ts` | `packages/core/src/cache/cache-stats.ts` |
| `src/lib/cache/query-cache-repo.ts` | `packages/core/src/cache/query-cache-repo.ts` |
| `src/lib/inventory/cache-policy.ts` | `packages/core/src/inventory/cache-policy.ts` (if exists & generic) |

### `src/lib/` → stays in `@ohmy-seo/yandex-seo` (Yandex-specific)

| Source | Destination |
|---|---|
| `src/lib/api-gateway.ts` | `packages/yandex-seo/src/lib/api-gateway.ts` |
| `src/lib/api/**` | `packages/yandex-seo/src/lib/api/**` |
| `src/lib/oauth/**` (token-broker + yandex-flow + login-probe) | `packages/yandex-seo/src/lib/oauth/**` |
| `src/lib/scopes.ts` | `packages/yandex-seo/src/lib/scopes.ts` |
| `src/lib/account-resolver.ts` | `packages/yandex-seo/src/lib/account-resolver.ts` |
| `src/lib/property-resolver.ts` | `packages/yandex-seo/src/lib/property-resolver.ts` |
| `src/lib/metrika-client.ts` | `packages/yandex-seo/src/lib/metrika-client.ts` |
| `src/lib/webmaster-client.ts` | `packages/yandex-seo/src/lib/webmaster-client.ts` |
| `src/lib/mutagen-client.ts` | `packages/yandex-seo/src/lib/mutagen-client.ts` (Phase 2 will move) |
| `src/lib/db/accounts-repo.ts` | `packages/yandex-seo/src/lib/db/accounts-repo.ts` (Yandex-specific schema) |
| `src/lib/db/oauth-apps-repo.ts` | `packages/yandex-seo/src/lib/db/oauth-apps-repo.ts` |
| `src/lib/db/inventory-repo.ts` | `packages/yandex-seo/src/lib/db/inventory-repo.ts` |
| `src/lib/inventory/refresher.ts` | `packages/yandex-seo/src/lib/inventory/refresher.ts` (Yandex-coupled) |

### `src/tools/` → `@ohmy-seo/yandex-seo` (all 19)

All 19 tool files move from `src/tools/` to `packages/yandex-seo/src/tools/` as-is. Import paths rewritten to `@ohmy-seo/mcp-core` for shared infra, local `../lib/` for Yandex specifics.

### Entry points

| Source | Destination |
|---|---|
| `src/index.ts` | `packages/yandex-seo/src/index.ts` — server name string stays `"mcp-yandex-seo"`, `.env` path adjusted |
| `src/smoke.ts` | `packages/yandex-seo/src/smoke.ts` |

## New files

| File | Lines | Hard cap | Responsibility |
|---|---|---|---|
| `package.json` (root) | ~25 | 50 | Workspace root metadata + pnpm config |
| `pnpm-workspace.yaml` | ~4 | 20 | `packages: [packages/*]` |
| `tsconfig.base.json` | ~20 | 40 | Shared TS compiler options |
| `packages/core/package.json` | ~30 | 60 | `@ohmy-seo/mcp-core` + exports map + deps |
| `packages/core/tsconfig.json` | ~15 | 30 | Extends base, `composite: true` |
| `packages/core/src/index.ts` | ~30 | 80 | Barrel re-exports for subpath imports |
| `packages/yandex-seo/package.json` | ~35 | 60 | Renamed from root + workspace dep on core |
| `packages/yandex-seo/tsconfig.json` | ~20 | 40 | Extends base, references core |
| `README.md` (root) | ~80 | 150 | Monorepo overview, package map, quickstart |

## Migration sequence (ordered, each = one task)

1. **TASK-701 Pre-flight backup.** `cp -a mcp-yandex-seo mcp-yandex-seo.bak.YYYYMMDD`; record sqlite row counts.
2. **TASK-702 GitHub rename.** `gh repo rename ohmy-seo -R VKirill/mcp-yandex-seo`.
3. **TASK-703 Local dir rename + remote URL.** `mv mcp-yandex-seo ohmy-seo`; `git remote set-url origin https://github.com/VKirill/ohmy-seo.git`.
4. **TASK-704 Worktree.** `git worktree add .worktrees/feat-monorepo -b feat/monorepo-phase-1`.
5. **TASK-705 Scaffold root.** Create root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`.
6. **TASK-706 Package shells.** Create `packages/{core,yandex-seo}/` dirs + placeholder `package.json` + `tsconfig.json`.
7. **TASK-707 `git mv` core files.** Move shared infra from `src/lib/{crypto,db,cache,http.ts,errors.ts}` → `packages/core/src/`. No body edits.
8. **TASK-708 `git mv` yandex-seo files.** Move remaining `src/lib/` + all `src/tools/` + `src/index.ts` + `src/smoke.ts` + `data/` + `.env` + `scripts/` → `packages/yandex-seo/`. No body edits.
9. **TASK-709 Rewrite imports — core.** Fix relative paths within core; nothing should reference `../tools/`. Verify `tsc --noEmit` clean.
10. **TASK-710 Core barrel + exports.** Author `packages/core/src/index.ts` and `package.json` `exports` map (subpaths: `/cache`, `/db`, `/http`, `/errors`, `/crypto`).
11. **TASK-711 Rewrite imports — yandex-seo.** Change relative `../lib/cache/...` → `@ohmy-seo/mcp-core/cache`, etc. Verify `.env` path resolution still works (compiled `dist/` is now nested deeper).
12. **TASK-712 Verify `data/state.db` path.** Audit `db/connection.ts` for path resolution; pin to package-relative or `process.cwd()`. Ensure DB opens 4 accounts post-move.
13. **TASK-713 Build all.** `pnpm install`; `pnpm -r build`; both packages produce `dist/`.
14. **TASK-714 Local smoke.** `pnpm -F @ohmy-seo/yandex-seo smoke` exits 0; prints 4 accounts.
15. **TASK-715 Update Claude Code config.** Back up `~/.claude.json`; update MCP entry `mcp-yandex-seo` `command`/`args` to new path; user restarts Claude Code.
16. **TASK-716 End-to-end MCP smoke (3 read-only calls).** `list_accounts` (4 rows), `list_oauth_apps` (≥1), `cache_stats`. User confirms.
17. **TASK-717 Merge + push.** Merge worktree → `main`; push to renamed remote.

## Verification plan

**Hard gates:**
- `pnpm -r build` exits 0
- `pnpm -F @ohmy-seo/mcp-core tsc --noEmit` exits 0
- `pnpm -F @ohmy-seo/yandex-seo tsc --noEmit` exits 0
- `sqlite3 packages/yandex-seo/data/state.db "select count(*) from accounts"` = 4
- `list_accounts` from fresh Claude Code session returns 4 accounts with non-null `yandex_login` each
- 1 read-only domain call (e.g. `yandex_webmaster_api` `endpoint=/v4/user`) succeeds (proves token refresh + http + cache + errors pipeline intact)
- `git log --follow packages/core/src/cache/cache-policy.ts` shows pre-rename history
- `gh repo view VKirill/ohmy-seo` returns 200

## Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `.env` path resolution breaks in `index.ts` post-move | high | server fails to start | Pin path explicitly relative to package root; verify in TASK-711 |
| `data/state.db` path resolves wrong | medium | DB not found, all tools 500 | Audit `connection.ts` in TASK-712; pin to absolute or process.cwd |
| Claude Code `~/.claude.json` edit corrupts JSON | low | all MCP servers offline | Back up before edit (TASK-715); edit with `jq` |
| `MCP_YANDEX_SEO_MASTER_KEY` rename temptation | medium | DB cannot decrypt | **Do not rename env var.** Keep literal name to preserve encryption compatibility |
| `better-sqlite3` rebuild failure under pnpm | medium | install fails | `pnpm rebuild better-sqlite3` if needed |
| GitHub redirect leaves stale URLs in skill docs | low | broken doc link | Out of scope; user decides if/when to update `~/.claude/skills/yandex-*` |

## Notes

- **Skills at `~/.claude/skills/yandex-*` are NOT touched.** They reference MCP server name (`mcp-yandex-seo`), which stays stable. Path references update is deferred.
- **`MCP_YANDEX_SEO_MASTER_KEY` env var name is preserved verbatim** — renaming it = breaking encryption, separate concern for indefinite future.
- **No logic edits** during Phase 1. Every code change is import-path rewrite. If a worker is tempted to "improve while moving" — that's out of scope, reject.
- **Backup at TASK-701 is the safety net.** If anything destructive goes wrong, restore is `rm -rf ohmy-seo && mv mcp-yandex-seo.bak.YYYYMMDD mcp-yandex-seo`.

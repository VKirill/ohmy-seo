<!-- ohmy-seo packages: @ohmy-seo/mcp-core, @ohmy-seo/yandex-seo, @ohmy-seo/mutagen, @ohmy-seo/xmlstock, @ohmy-seo/google-search-console, @ohmy-seo/ga4, @ohmy-seo/gtm, @ohmy-seo/google-ads, @ohmy-seo/roistat. See README.md for full package list, MCP server names, and OAuth setup. -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ohmy-seo** (7321 symbols, 14263 relationships, 622 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/ohmy-seo/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ohmy-seo/clusters` | All functional areas |
| `gitnexus://repo/ohmy-seo/processes` | All execution flows |
| `gitnexus://repo/ohmy-seo/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Ship protocol (MCP + сайт + прод)

Задача не сдана, пока изменения не на **GitHub `main`** и не в **живом** `https://mcp.ohmy-seo.ru/mcp` / `https://ohmy-seo.ru`. Push в git ≠ выкладка: шлюз печёт MCP из **тега** `OHMY_SEO_REF` при `docker compose build`, контейнеры сами не обновляются.

Не спрашивать «нужен commit / push / деплой?». После рабочей правки — сразу все поверхности, коммит, push `main`, тег, выкладка. Не коммитить секреты (`.env`, `hosting/secrets/`) и автоген Next.js `hosting/apps/web/AGENTS.md`, `hosting/apps/web/CLAUDE.md`.

## Поверхности (менять одним заходом)

| Что меняется | Куда ещё |
|---|---|
| Инструмент MCP (`packages/*/src`) | реестр тула; тесты |
| Тул должен быть в облаке | `hosting/apps/gateway/src/tool-policy.ts` (`WRITE_TOOLS` / `READ_TOOLS` + политика url/path/base64) и `hosting/tests/tool-policy.test.ts` |
| Имя/смысл тула для людей | `README.md`, `skills/ohmy-seo-mcp/SKILL.md`, при API-quirk — `skills/ohmy-seo-mcp/references/yandex-direct-api-quirks.md` |
| Карточка на сайте | `hosting/apps/web/src/lib/marketing/catalog.ts` |

Локальный stdio-MCP читает исходники пакета. Облачный MCP читает **клон GitHub внутри образа gateway** (`Dockerfile`: `git clone --branch $OHMY_SEO_REF`). Код шлюза и сайта — из каталога стека на VPS (`/home/ohmy-seo/stack` = содержимое `hosting/`), не из `main` само собой.

## Git

1. `detect_changes({scope:"all", repo:"ohmy-seo"})` до коммита (GitNexus).
2. Коммит в `main`, сообщение — зачем.
3. `git push origin main`.
4. Аннотированный тег semver (`v0.10.1`, …) на этот коммит: `git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z`.
5. Проставить тот же тег в `hosting/.env.example`, `hosting/compose.yml` (`OHMY_SEO_REF:-…`), `hosting/apps/gateway/Dockerfile` (`ARG OHMY_SEO_REF=…`) — и закоммитить, если ещё не в том же коммите.

`ad_id` комбинаторных объявлений — **строка цифр** (19 знаков > 2⁵³). Не учить агентов передавать JSON-number.

## Прод (обязательно после push тега)

Хост: SSH `ovh-main` (VPS). Стек: `/home/ohmy-seo/stack` (владелец `ohmy-seo`). Docker с `sudo`. Не печатать `.env` и секреты.

```bash
# с машины разработки, из корня репо:
rsync -az --exclude '.env' --exclude '.env.*' --exclude 'secrets/' \
  --exclude 'node_modules/' --exclude '.next/' --exclude 'dist/' --exclude '.gitnexus/' \
  hosting/ ovh-main:/tmp/ohmy-seo-hosting-sync/

ssh ovh-main 'sudo rsync -a --exclude ".env" --exclude ".env.*" --exclude "secrets/" \
  /tmp/ohmy-seo-hosting-sync/ /home/ohmy-seo/stack/ && \
  sudo sed -i "s/^OHMY_SEO_REF=.*/OHMY_SEO_REF=vX.Y.Z/" /home/ohmy-seo/stack/.env && \
  sudo grep "^OHMY_SEO_REF=" /home/ohmy-seo/stack/.env && \
  sudo docker compose -f /home/ohmy-seo/stack/compose.yml --project-directory /home/ohmy-seo/stack \
    build web gateway && \
  sudo docker compose -f /home/ohmy-seo/stack/compose.yml --project-directory /home/ohmy-seo/stack up -d'
```

Подставить фактический тег вместо `vX.Y.Z`. Сборка gateway клонирует GitHub — без свежего тега на origin образ останется старым. После `up` проверить `/healthz` и что в `tools/list` облачного MCP есть новые имена. Подробности: `hosting/OPERATIONS.md`, `hosting/AGENTS.md`.

# Phase 3.5.B — Yandex Direct API full coverage + live test cycle

## Goal

Закрыть Yandex Direct API в нашем MCP полностью: пофиксить gateway-баг (POST/GET default per-API), снять ложную `READ_ONLY` annotation, добавить 7 типизированных read-wrappers поверх generic gateway, реализовать write-tools для создания кампаний/групп/объявлений (поиск + РСЯ раздельно) с загрузкой изображений и привязкой целей Metrika, провести end-to-end live smoke на боевом MCC-аккаунте с обязательной очисткой, добавить DANGER-tools (pause / resume / delete / минусация / бюджеты) с двойным confirm-gate.

## Non-goals

- Google Ads API — отдельная Phase 4.
- Скилл `yandex-direct` (API-документация) уже существует и не переписывается. Здесь — реализация tools.
- CSV → массовая загрузка из Key Collector — это Phase 3.5.C (зависит от этого SPEC'а).
- Cron-режим автономного агента-маркетолога — Phase 5.
- Полный Reports API (TSV, batch reports, retargeting реструктуризация) — только GET-обёртка, без управления отчётами как сущностями.

## Override на split-правило

Score этой фазы 13+ → по правилам должна быть split на 4 подфазы (B.1-B.4). Пользователь явно потребовал «всё в одной волне» — фиксирую override в самом SPEC, чтобы будущие codex-проверки понимали почему так. Все compensating controls (live тесты в PAUSED, обязательный cleanup, малые бюджеты, sequential dependencies между группами задач) остаются в силе.

## Live-environment контракт (DRAFT-only, без moderate)

Все live-тесты выполняются на **реальном** Yandex Direct MCC-аккаунте `yandex-direct-prod-main` (id=9 в нашей БД, логин `ki.vech`). Sandbox не используется потому что у нас не настроены тестовые аккаунты в нём.

**Ключевой принцип безопасности — DRAFT-only:**
- Все кампании создаются как **черновики** (Direct: `Ads.add` создаёт ad в DRAFT, `Campaigns.add` создаёт кампанию которая до первой `Ads.moderate` не отправляется).
- **`Ads.moderate` НЕ вызывается** ни на одном этапе тестового цикла. Drafts не уходят на модерацию, не показываются, не тратят бюджет, не требуют SUSPENDED-барьера.
- После создания verify через `Campaigns.get` + `Ads.get`, потом cleanup. Никакого живого размещения.

**Защитный контракт для live-операций (обязателен в каждом write-tool и smoke-скрипте):**

| Контроль | Значение |
|---|---|
| Что создаём | DRAFT (через Ads.add, без последующего moderate) |
| Дневной бюджет тест-кампаний | 100 RUB (формальное поле, для draft не активируется) |
| Гео по умолчанию | Москва (regionId 213) — для согласованности данных |
| Префикс имени | `phase-3-5-b-test_` — обязателен для всех созданных сущностей |
| Resource ledger | Append-only JSONL в `packages/yandex-seo/scripts/.b3-smoke-ledger.jsonl` — каждое успешное create пишет ID сразу после ответа API |
| Cleanup strategy | `try/finally` оборачивает весь smoke; pre-cleanup всех `phase-3-5-b-test_*` перед стартом; финальный cleanup через ledger; standalone флаг `--cleanup-only` для recovery |
| Cleanup команда | `archive` + `delete`. Если delete недоступен по правам — archived остаётся, ID в final-report для ручной зачистки |

Этот DRAFT-only подход устраняет два критических риска:
1. Codex round-1 finding про «нет verified suspend barrier» — отпадает, потому что drafts вообще не идут на модерацию.
2. Утечка бюджета через accidentally-served ads — невозможна, drafts не показываются.

## Acceptance criteria

### B.1 — Gateway fix + READ coverage smoke

- [ ] В `packages/yandex-seo/src/lib/api/endpoints-spec.ts` добавлено поле `defaultMethod` в `ApiSpec`, заполнено: direct → POST, metrika → GET, webmaster → GET.
- [ ] В `packages/yandex-seo/src/lib/api-gateway.ts` `executeApiCall` использует `spec.defaultMethod` если `opts.method` не передан.
- [ ] Tool `yandex_direct_api` (packages/yandex-seo/src/tools/yandex-direct-api.ts) больше НЕ применяет default `"GET"` — оставляет `undefined` и доверяет gateway-default из spec.
- [ ] В описании `yandex_direct_api` снят/исправлен ложный READ_ONLY annotation: гейтвей помечен как способный к мутациям, добавлено предупреждение что для безопасных read-методов нужно вызывать с `body.method` из whitelist'а (`get`, `getReport`, `search*`, `*Items`).
- [ ] Создан `packages/yandex-seo/scripts/direct-coverage-smoke.ts` который от `yandex-direct-prod-main` пробегает GET-методы по всем 15 services Direct и выводит markdown coverage-матрицу в stdout + сохраняет в `docs/plans/phase-3-5-b-direct-api-coverage/coverage-matrix.md`.
- [ ] Smoke прогон успешен: для каждого service либо «OK + N сущностей», либо «error_code X + описание».

### B.2 — Typed read wrappers

- [ ] 7 новых tools в `packages/yandex-seo/src/tools/`:
  - `direct-list-campaigns.ts` — фильтры по статусам/типам, страничный обход
  - `direct-list-adgroups.ts` — фильтр по campaign_ids
  - `direct-list-ads.ts` — фильтр по adgroup_ids
  - `direct-list-keywords.ts` — фильтр по adgroup_ids + state
  - `direct-get-stats.ts` — Reports v5 с polling 201/202 (Retry-After), TSV-парсинг
  - `direct-get-search-terms.ts` — отчёт по фактическим поисковым запросам (нужно для крон-чистки мусорных)
  - `direct-get-change-history.ts` — Changes:checkDictionaries + Changes:check
- [ ] Все 7 tools зарегистрированы в `packages/yandex-seo/src/index.ts` + есть Zod schemas для input/output.
- [ ] Каждый tool успешно вызывается против реального аккаунта (минимум `get` с пустыми фильтрами).

### B.3 — Live write + image upload + Metrika goal linking

- [ ] Tool `direct-upload-image.ts` — принимает URL или локальный путь, скачивает (если URL), POST на `/json/v5/adimages` с binary body, возвращает `AdImageHash`.
- [ ] Tool `direct-create-campaign.ts` — универсальный с параметром `type: 'search' | 'rsya' | 'rsya-only'`, создаёт кампанию (Direct сам ставит её в неактивный статус до первой moderation); бюджет 100 RUB, гео=Москва, имя с префиксом `phase-3-5-b-test_`. **НЕ вызывает Ads.moderate ни на каком этапе** — все объявления остаются DRAFT.
- [ ] Tool `direct-create-adgroup.ts` — создаёт группу, принимает campaign_id, name, region_ids, keywords.
- [ ] Tool `direct-create-ad-tgo.ts` — текстово-графическое объявление (заголовок, доп.заголовок, текст, отображаемая ссылка, target URL).
- [ ] Tool `direct-create-ad-rsya.ts` — РСЯ объявление с AdImageHash из upload-image.
- [ ] Tool `direct-link-metrika-goals.ts` — связывает Metrika counter ID (54918634) + goal ID (254644847) с кампанией через Campaigns:update.
- [ ] End-to-end live smoke (`scripts/b3-live-smoke.ts`) — **DRAFT-only, без moderate**:

  **Pre-cleanup (перед стартом) — ledger-only по умолчанию:**
  0a. Если existing ledger-файл `.b3-smoke-ledger.jsonl` есть → прочитать ID из него и почистить **только их** (ledger-owned cleanup, не трогаем чужие сущности).
  0b. Опционально: если запущено с флагом `--force-prefix-cleanup` → дополнительно сделать `Campaigns.get` с фильтром Name LIKE `phase-3-5-b-test_%` и интерактивно подтвердить (или dry-run если не TTY) перед archive+delete по prefix. По умолчанию prefix-cleanup ОТКЛЮЧЁН чтобы не зацепить чужие кампании если кто-то ещё запускал тест.
  0c. Удалить ledger после успешного pre-cleanup, создать новый пустой для текущего запуска.

  **Чтение CSV (источник данных для группы):**
  Перед стартом создания скрипт **читает `/home/ubuntu/downloads/test_direct.csv`** (UTF-8 BOM, `;`-разделитель) и парсит **кластер #1** целиком — он содержит 10 ключевых фраз про «стобальный репетитор онлайн школа», тип `informational`, частотности 0-190. Все 10 фраз пойдут в одну AdGroup (это и есть структура «кластер = группа»). Если CSV недоступен — fallback на жёстко зашитый mini-набор из 3 фраз с пометкой «csv not found, used fallback» в report.

  **Создание (в try { } блоке, каждое успешное create → запись в ledger):**
  1. Создаёт search-кампанию `phase-3-5-b-test_search_<timestamp>` на vechkasov.ru, бюджет 100, geo=213
  2. Verify через `Campaigns.get` — кампания существует, поля корректны
  3. Пытается привязать Metrika counter 54918634 + goal 254644847 (стратегия WB_DAILY_BUDGET). Если Direct отвергает по стратегии — лог в report, продолжаем без блокера (Metrika linking опциональный для основного smoke).
  4. Создаёт AdGroup `1_stobalniy-repetitor` (paттерн naming из Phase 3.5.A) + **ВСЕ 10 keywords из кластера #1** (отдельные Keyword entities через Keywords.add batch) + **2 ТГО-объявления** (variant A «образовательный лидмагнит» + variant B «проблема-решение» из composition-templates.md). Все Ads **остаются DRAFT**.
  5. Создаёт RSYa-кампанию `phase-3-5-b-test_rsya_<timestamp>` (type=NETWORK_ONLY, бюджет 100)
  6. Скачивает картинку с Unsplash (https://images.unsplash.com/photo-1503676260728-1c00da094a0b — landscape ~1080x720, JPG) → uploadImage → получает hash
  7. Verify через `AdImages.get` что hash зарегистрирован
  8. Создаёт AdGroup `1_stobalniy-repetitor-rsya` (тот же cluster_id, маркер +rsya) + **те же 10 keywords** + **2 РСЯ-объявления** с этой картинкой (variant A + B). Все Ads **остаются DRAFT**.
  9. **НЕ вызываем Ads.moderate.** Все 4 ad'а (2 ТГО + 2 РСЯ) остаются DRAFT.
  10. Verify через `Ads.get` что 4 ad'а в state=DRAFT, через `Keywords.get` что 20 ключей (10×2 групп) добавлены, через `AdGroups.get` что 2 группы созданы.

  **Cleanup (в finally { } блоке, читает из ledger):**
  11. Для каждой ID в ledger: archive → delete. Soft-fail: если delete недоступен, оставляем archived + помечаем в report.

  **Recovery mode:**
  12. Скрипт принимает флаг `--cleanup-only` который чистит всё что в ledger без создания нового. Используется если предыдущий запуск crash'нул посередине.

  **Report:** все шаги + ID + статусы → `docs/plans/phase-3-5-b-direct-api-coverage/live-smoke-report.md`

### B.4 — DANGER wrappers + confirm-gate

- [ ] `direct-pause-campaigns.ts` — массовая пауза, требует `confirm: true` + `acknowledge_live: "I-UNDERSTAND-PAUSE-LIVE:<account_login>:<campaign_ids_csv>"` (паттерн из Phase 4 SPEC).
- [ ] `direct-resume-campaigns.ts` — массовое возобновление, тот же gate.
- [ ] `direct-delete-campaigns.ts` — удаление, тот же gate + дополнительный env-флаг `YANDEX_DIRECT_ALLOW_DELETE=true`.
- [ ] `direct-negative-keywords-add.ts` — массовая минусация (DANGER lite, только confirm: true без acknowledge — минусация менее опасна).
- [ ] `direct-update-budgets.ts` — изменение дневного бюджета (DANGER, full gate).
- [ ] Все 5 tools отказывают если **оба** env-флага не заданы в `true`:
  - `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` — глобальный платформо-нейтральный (был `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS`, переименовываем чтобы не смешивать платформы — codex round-1 finding)
  - `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` — Yandex-специфичный
  - `direct-delete-campaigns` дополнительно требует `YANDEX_DIRECT_ALLOW_DELETE=true`
- [ ] Phase 4 SPEC (Google Ads) тоже переименовывает свой флаг с `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` на `OHMY_SEO_ALLOW_LIVE_MUTATIONS` + `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` (отдельный платформо-специфичный). Это правка должна быть синхронизирована при старте Phase 4 — фиксируем в `docs/plans/phase-4-google-ads/SPEC.md` как известную миграцию.

## File plan

| File | Status | Lines (est) | Hard cap |
|---|---|---|---|
| `packages/yandex-seo/src/lib/api/endpoints-spec.ts` | Modified | +5 | — |
| `packages/yandex-seo/src/lib/api-gateway.ts` | Modified | +3 | — |
| `packages/yandex-seo/src/tools/yandex-direct-api.ts` | Modified | +5 / -2 | — |
| `packages/yandex-seo/scripts/direct-coverage-smoke.ts` | New | ~220 | 350 |
| `packages/yandex-seo/src/tools/direct-list-campaigns.ts` | New | ~80 | 150 |
| `packages/yandex-seo/src/tools/direct-list-adgroups.ts` | New | ~70 | 150 |
| `packages/yandex-seo/src/tools/direct-list-ads.ts` | New | ~80 | 150 |
| `packages/yandex-seo/src/tools/direct-list-keywords.ts` | New | ~80 | 150 |
| `packages/yandex-seo/src/tools/direct-get-stats.ts` | New | ~220 | 350 (Reports v5 polling) |
| `packages/yandex-seo/src/tools/direct-get-search-terms.ts` | New | ~120 | 200 |
| `packages/yandex-seo/src/tools/direct-get-change-history.ts` | New | ~110 | 200 |
| `packages/yandex-seo/src/tools/direct-upload-image.ts` | New | ~140 | 220 |
| `packages/yandex-seo/src/tools/direct-create-campaign.ts` | New | ~200 | 350 |
| `packages/yandex-seo/src/tools/direct-create-adgroup.ts` | New | ~100 | 180 |
| `packages/yandex-seo/src/tools/direct-create-ad-tgo.ts` | New | ~130 | 220 |
| `packages/yandex-seo/src/tools/direct-create-ad-rsya.ts` | New | ~130 | 220 |
| `packages/yandex-seo/src/tools/direct-link-metrika-goals.ts` | New | ~90 | 160 |
| `packages/yandex-seo/scripts/b3-live-smoke.ts` | New | ~260 | 400 |
| `packages/yandex-seo/src/tools/direct-pause-campaigns.ts` | New | ~110 | 180 |
| `packages/yandex-seo/src/tools/direct-resume-campaigns.ts` | New | ~110 | 180 |
| `packages/yandex-seo/src/tools/direct-delete-campaigns.ts` | New | ~110 | 180 |
| `packages/yandex-seo/src/tools/direct-negative-keywords-add.ts` | New | ~110 | 180 |
| `packages/yandex-seo/src/tools/direct-update-budgets.ts` | New | ~120 | 200 |
| `packages/yandex-seo/src/index.ts` | Modified | +50 | — |
| `packages/yandex-seo/src/lib/api/confirm-gate.ts` | New | ~80 | 150 |
| `docs/plans/phase-3-5-b-direct-api-coverage/coverage-matrix.md` | Generated | (artifact) | — |
| `docs/plans/phase-3-5-b-direct-api-coverage/live-smoke-report.md` | Generated | (artifact) | — |

**Итого:** ~2900 строк нового TypeScript + 50 строк правок существующего кода + 2 markdown-артефакта.

## Dependencies

- **NPM libraries:** ничего нового — используем существующие (`zod`, `better-sqlite3`, builtin `fetch`).
- **Skills для воркеров:** `yandex-direct` (API-контракт), `mcp-server`, `nodejs`, `karpathy-guidelines`.
- **Среда:** `MCP_YANDEX_SEO_MASTER_KEY` (есть в `~/.claude.json`), доступ к Direct API через OAuth (TASK-9001 уже подключил).
- **Env-флаги — Yandex DANGER tools читают ТОЛЬКО эти два, никогда не `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS`:**
  - `OHMY_SEO_ALLOW_LIVE_MUTATIONS=true` — глобальный платформо-нейтральный флаг (общий с Google Ads SPEC Phase 4 после её обновления)
  - `YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true` — Yandex-специфичный, второй обязательный слой
  - `YANDEX_DIRECT_ALLOW_DELETE=true` — дополнительный третий слой только для `direct-delete-campaigns`
  - Acceptance: для каждого DANGER tool unit-тест на «отсутствие OHMY_SEO_* флага → отказ» и «отсутствие YANDEX_DIRECT_* флага → отказ» (две отдельные проверки)
  - **НЕ читать `GOOGLE_ADS_ALLOW_LIVE_MUTATIONS` ни при каких условиях** — изоляция платформ.

## Architecture decisions

- **Один `confirm-gate` модуль на пакет** — `packages/yandex-seo/src/lib/api/confirm-gate.ts` экспортирует `requireConfirmGate(input, expectedAck)`, который используется во всех DANGER-tools. Не дублируем логику.
- **Reports v5 polling — отдельный helper** внутри `direct-get-stats.ts` (или отдельный модуль `packages/yandex-seo/src/lib/api/reports-polling.ts` если стат-туллов будет больше одного — пока один). Polling логика: **POST** `/json/v5/reports` с тем же JSON body (включая SelectionCriteria + FieldNames + ReportType + DateRangeType + Format=TSV) → 200 (готов, TSV в body) / 201 (создан, ждать `retryIn`) / 202 (в обработке, ждать `retryIn`) → max 60s wall-clock на отчёт. На каждом polling-цикле — повторный POST с тем же body. **GET НЕ используется** (codex round-1 fix). Header `processingMode: auto` для авто-выбора online/offline.
- **Image upload** — отдельный шаг от создания ad'а. Tool принимает URL или путь, возвращает hash. Создание РСЯ-ad'а принимает hash отдельным полем. Это позволяет переиспользовать одну картинку в нескольких ads.
- **Метрика-goal linking — Campaigns:update**, **специфично к стратегии** (codex round-1 fix). Direct различает три места куда падают goal IDs:
  - `CounterIds[]` — массив Metrika counter IDs (это всегда у кампании, безотносительно стратегии)
  - `PriorityGoals[]` — приоритетные цели для оптимизации в авто-стратегиях типа WB_DAILY_BUDGET / WB_DAILY_BUDGET_DEFAULT_DETERMINED_GOALS
  - `Strategy.GoalId` — для AVERAGE_CPA / AVERAGE_ROI / PAY_FOR_CONVERSION стратегий
  - Portfolio strategies — отдельный контракт, **не поддерживаем в B.3**, явно falling back if encountered.

  Tool `direct-link-metrika-goals.ts` принимает обязательное поле `strategy_type: 'WB_DAILY_BUDGET' | 'AVERAGE_CPA' | ...`, валидирует комбинацию counter+goal+strategy перед `Campaigns.update`, после update — обязательный `Campaigns.get` чтобы подтвердить что поле реально сохранилось. Если Direct отвергает по причине несовместимости стратегии → возвращает структурированную ошибку с указанием совместимых стратегий, не сваливается в generic 500.

  Перед update — `direct_get_metrika_goals` (новый sub-helper) вызывает Metrika API `/management/v1/counter/<id>/goals` чтобы проверить что goal 254644847 действительно существует и принадлежит counter 54918634. Если нет → ранний exit с понятной ошибкой.
- **Cleanup в smoke — soft-fail:** если archive/delete упал, не стопает весь скрипт, но пишет в report-file список несношенных сущностей чтобы пользователь смог снести руками.
- **Сохранение coverage-matrix и live-smoke-report как markdown** — в `docs/plans/phase-3-5-b-direct-api-coverage/`, чтобы можно было закоммитить как evidence.

## Risk profile

- **B.1 — low risk:** только TS-правки, без живых API-вызовов кроме read-smoke.
- **B.2 — low risk:** только read-методы, GET-only.
- **B.3 — medium risk:** создаются реальные кампании, но в PAUSED + 100 RUB бюджет + Москва + обязательный cleanup. Если cleanup провалится — orphan'ы можно снести руками в UI.
- **B.4 — medium-high risk:** DANGER tools потенциально могут что-то паузить/удалять. Триггерятся только тестом и cleanup'ом в smoke; production-использование требует осознанного `confirm + acknowledge_live + env`.

## Checklist (26 task contracts)

### Group B.1 — Foundation (sequential)

1. **TASK-3520** — `endpoints-spec.ts`: add `defaultMethod` field to ApiSpec. risk: low. deps: none.
2. **TASK-3521** — `api-gateway.ts`: use `spec.defaultMethod` when method not provided. risk: low. deps: TASK-3520.
3. **TASK-3522** — `yandex-direct-api.ts`: remove default `"GET"`, fix annotation, add method whitelist for read mode. risk: low. deps: TASK-3521.
4. **TASK-3523** — `direct-coverage-smoke.ts` script + run + save coverage matrix. risk: low. deps: TASK-3522.

### Group B.2 — Read wrappers (parallel after B.1)

5. **TASK-3524** — `direct-list-campaigns.ts` + register. risk: low. deps: TASK-3523.
6. **TASK-3525** — `direct-list-adgroups.ts` + register. risk: low. deps: TASK-3523.
7. **TASK-3526** — `direct-list-ads.ts` + register. risk: low. deps: TASK-3523.
8. **TASK-3527** — `direct-list-keywords.ts` + register. risk: low. deps: TASK-3523.
9. **TASK-3528** — `direct-get-stats.ts` (Reports v5 + polling helper) + register. risk: medium. deps: TASK-3523.
10. **TASK-3529** — `direct-get-search-terms.ts` + register. risk: low. deps: TASK-3528 (use polling helper).
11. **TASK-3530** — `direct-get-change-history.ts` + register. risk: low. deps: TASK-3523.
12. **TASK-3531** — Smoke-test all 7 read wrappers against real account. risk: low. deps: 3524-3530.

### Group B.3 — Live write + image + goal (sequential, depends on B.2)

13. **TASK-3532** — `confirm-gate.ts` shared module. risk: low. deps: TASK-3531.
14. **TASK-3533** — `direct-upload-image.ts` + register. risk: medium. deps: TASK-3532.
15. **TASK-3534** — `direct-create-campaign.ts` (search/rsya types, **DRAFT-only — кампания создаётся через Campaigns.add, ads создаются Ads.add без последующего Ads.moderate**) + register. risk: medium. deps: TASK-3532. Acceptance: код tool НЕ содержит вызовов `Ads.moderate` или `moderate` любых других сущностей.
16. **TASK-3535** — `direct-create-adgroup.ts` + register. risk: low. deps: TASK-3534.
17. **TASK-3536** — `direct-create-ad-tgo.ts` + register. risk: low. deps: TASK-3535.
18. **TASK-3537** — `direct-create-ad-rsya.ts` (uses image hash) + register. risk: low. deps: TASK-3533, TASK-3535.
19. **TASK-3538** — `direct-link-metrika-goals.ts` + register. risk: low. deps: TASK-3534.
20. **TASK-3539** — `b3-live-smoke.ts` end-to-end script: DRAFT-only flow (pre-cleanup → create search + rsya campaigns on vechkasov.ru with goal 254644847 → image upload → AdGroups + Keywords + Ads все в DRAFT → verify через Get → try/finally cleanup через ledger). **БЕЗ Ads.moderate, БЕЗ status polling модерации**. Risk: high (live API, но без модерации/трат). deps: 3533-3538. Acceptance: грeп по `b3-live-smoke.ts` не находит ни `moderate`, ни `Moderate`.

### Group B.4 — DANGER wrappers (sequential, depends on B.3 confirmed)

21. **TASK-3540** — `direct-pause-campaigns.ts` (confirm + acknowledge_live + env). risk: medium. deps: TASK-3539.
22. **TASK-3541** — `direct-resume-campaigns.ts`. risk: medium. deps: TASK-3540.
23. **TASK-3542** — `direct-delete-campaigns.ts` (extra env flag YANDEX_DIRECT_ALLOW_DELETE). risk: medium. deps: TASK-3540.
24. **TASK-3543** — `direct-negative-keywords-add.ts` (DANGER lite). risk: medium. deps: TASK-3532.
25. **TASK-3544** — `direct-update-budgets.ts`. risk: medium. deps: TASK-3532.
26. **TASK-3545** — Final monorepo build + audit: `pnpm -r build` зелёный, `task list` показывает всё done, finальный report в `docs/plans/phase-3-5-b-direct-api-coverage/final-report.md`. risk: low. deps: 3540-3544.

## Dependency graph (simplified)

```
3520 → 3521 → 3522 → 3523 ┬─→ 3524, 3525, 3526, 3527 ─┐
                          ├─→ 3528 → 3529              ├─→ 3531
                          └─→ 3530                     ─┘
                                                          ↓
                                                        3532
                                                          ↓
                       3533 ────┐
                       3534 ────┼─→ 3539 → 3540 → 3541
                       3535 ────┤            └─→ 3542
                       3536 ────┤
                       3537 ────┤
                       3538 ────┘
                                  3543 ───┐
                                  3544 ───┴─→ 3545
```

## Open questions / risks remaining

1. **Sandbox vs production** — мы идём через production с PAUSED. Если хочешь sandbox — нужно сначала создать тест-аккаунт через `Yandex Direct UI → API Center → Create test account`, потом подключить отдельным OAuth. Скажешь — поднимется отдельной мини-фазой.
2. **Cleanup orphan'ов** — если `direct-delete-campaigns` упадёт из-за env-флага, кампании останутся archived (Direct не сразу удаляет архивные). Это допустимая «грязь», ты можешь снести руками. Smoke-report укажет точные ID.
3. **Image upload format** — Direct требует JPG/PNG, ≤ 10 МБ. Unsplash отдаёт JPG → ок. Если есть свой URL для тестовой картинки — скажешь, заменю.
4. **Metrika goal type** — счётчик 54918634 и goal 254644847 должны быть **доступны OAuth-аккаунту** (то есть Metrika-аккаунт должен быть прилинкован к тому же `ki.vech`-логину). Если goal принадлежит другому Metrika-аккаунту → Direct отвергнет `Campaigns:update`. Проверим в TASK-3538 smoke; если так — придётся сначала прилинковать Metrika.

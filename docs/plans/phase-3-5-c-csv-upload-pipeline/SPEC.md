# Phase 3.5.C — CSV → Direct upload pipeline (high-level orchestration)

## Goal

Поверх low-level tools Phase 3.5.B построить **один high-level MCP-tool** `yandex_direct_upload_campaign_bundle`, который принимает CSV Key Collector + параметры стратегии и автоматически создаёт пакет DRAFT-кампаний в Yandex Direct: campaign × N → adgroup × M → keywords × K → ads × 2-3 на группу. С canary-протоколом, ledger-recovery, dry-run по умолчанию, и опциональной привязкой Metrika goals.

Целевая user story: ads-specialist (или сам пользователь) даёт скиллу путь к CSV → подтверждает стратегию маппинга → через 2-5 минут получает в кабинете Direct готовый пакет drafts ready for review.

## Non-goals

- НЕ автоматическая модерация (drafts остаются drafts, пользователь сам жмёт moderate).
- НЕ управление ставками после загрузки — это отдельные DANGER tools (`update_budgets`, `negative_keywords_add`) уже в Phase 3.5.B.
- НЕ continuous monitoring / автономный агент с кроном — Phase 5.
- НЕ запись объявлений и копирайтинг — это делает агент (ads-specialist) ДО вызова pipeline, используя `yandex-direct-creatives` skill. Pipeline принимает уже готовый payload.
- НЕ полное покрытие всех корнер-кейсов CSV (только формат Key Collector с 25 колонками).

## Architecture

```
                   ads-specialist agent (writes copy from CSV cluster)
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │  yandex_direct_upload_       │
                       │  campaign_bundle (MCP tool)  │  ← новый tool в Phase 3.5.C
                       └──────────────────────────────┘
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │  upload-pipeline.ts          │  ← оркестратор
                       │  (canary + ledger + retry)   │
                       └──────────────────────────────┘
                          │              │             │
                          ▼              ▼             ▼
                    create_campaign  upload_image   create_ad_*
                    create_adgroup   keywords.add   link_metrika_goals
                    (all DRAFT-only — Phase 3.5.B tools, переиспользуем)
```

**Это НЕ замена B.3 tools — это слой оркестрации поверх них.**

## Input schema (Zod)

```ts
{
  // Source data
  csv_path: string,  // абсолютный путь к Key Collector CSV
  
  // Strategy mapping
  campaign_strategy: 
    | { mode: "one-per-cluster" }
    | { mode: "one-per-intent", intent_to_campaign: Record<"informational"|"transactional"|"branded"|"navigational", string> }
    | { mode: "single-campaign", campaign_name: string },
  
  campaign_type: "search" | "rsya" | "rsya-only",
  
  // Targeting
  site_url: string,  // например "https://vechkasov.ru" — идёт в Href всех объявлений
  daily_budget_rub: number,  // min 100
  region_ids: number[],  // например [213] = Moscow
  bidding_strategy_type: "WB_DAILY_BUDGET" | "HIGHEST_POSITION" | "AVERAGE_CPC",
  
  // Optional Metrika
  metrika_counter_ids?: number[],
  metrika_goal_ids?: number[],
  
  // Optional images for RSYA (если campaign_type содержит rsya)
  rsya_image_urls?: string[],  // если несколько — раунд-робин между группами
  
  // Ads composition
  ads_per_group: number,  // default 3 — Direct рекомендует 3-5
  ad_template_strategy: "agent-provided" | "fallback-template",
  ad_templates?: Array<{
    cluster_filter?: { intent?: string, cluster_id_pattern?: string },
    variant_label: string,  // например "informational-A"
    title: string,
    title2?: string,
    text: string,
    sitelinks?: Array<{title:string, description?:string, href:string}>,
    callouts?: string[],
  }>,
  
  // Safety
  dry_run: boolean,  // DEFAULT TRUE — без явного false ничего реально не создаётся
  canary_percent: number,  // default 10 — первые 10% кластеров загружаются как canary, потом пауза для оценки
  max_clusters: number,  // default 50 — hard cap на одну операцию
  abort_on_error_rate: number,  // default 0.3 — если >30% ошибок после canary, останавливаемся
  
  // Confirm gate
  confirm: boolean,
  acknowledge_live: string,  // pattern: `I-UNDERSTAND-BUNDLE-LIVE:<account>:<site_url>:<N_clusters>`
  
  account?: string,
}
```

## Output schema

```ts
{
  dry_run: boolean,
  total_clusters: number,
  clusters_processed: number,
  campaigns_created: number[],  // IDs
  ad_groups_created: number[],
  keywords_added: number,
  ads_created: number[],
  images_uploaded: string[],  // hashes
  metrika_linked: boolean,
  canary_passed: boolean,
  ledger_path: string,
  errors: Array<{ cluster_id: string, step: string, error: string }>,
  recovery_command: string,  // например `npx tsx scripts/bundle-recovery.ts --ledger <path>`
  next_actions: string[],  // human-readable — что делать дальше
}
```

## Lifecycle (two-stage gate, plan-hash binding, pending/committed ledger)

### Stage 0 — Dry-run plan generation (default, always first)

```
1. Validate inputs (Zod + business rules)
2. Read CSV, sha256 hash content → CSV_HASH
3. Resolve account: account.id, account.yandex_login, account.client_login → ACCOUNT_FINGERPRINT
4. Parse CSV, group by Кластер → list of cluster_descriptors
5. Apply max_clusters cap, filter by intent if configured
6. Build PLAN_HASH = sha256(JSON.stringify({
     csv_hash: CSV_HASH,
     account_fingerprint: ACCOUNT_FINGERPRINT,
     campaign_strategy, campaign_type, site_url,
     daily_budget_rub, region_ids: sorted, bidding_strategy_type,
     metrika_counter_ids, metrika_goal_ids,
     rsya_image_urls: sorted, ads_per_group,
     canary_percent, max_clusters,
     cluster_count: actual_after_caps,
     campaign_names: sorted list of planned campaign names,
   }))
7. Compute expected_ack_live = `I-UNDERSTAND-BUNDLE-LIVE:<account.yandex_login>:<PLAN_HASH_first_12_chars>`
8. If dry_run:
   - Print plan + PLAN_HASH + expected_ack_live
   - Print: «To run live: re-call with dry_run=false, confirm=true, acknowledge_live=<value>, plan_hash=<PLAN_HASH>»
   - Return {dry_run: true, plan_hash, expected_ack_live, ...}
9. If NOT dry_run: require input.plan_hash to be present.
   If input.plan_hash !== PLAN_HASH computed from current inputs → ABORT with "plan changed since dry-run, re-run dry_run to get fresh plan_hash"
   This binds live execution to the exact dry-run output.
10. requireConfirmGate (env flags + confirm + acknowledge_live exact match against expected_ack_live)
```

### Stage 1 — Pre-flight + canary (Stage 0 passed)

```
11. Initialize ledger at packages/yandex-seo/data/bundle-ledger-<PLAN_HASH_short>-<ts>.jsonl
    Stable filename = recovery target.
12. Pre-cleanup: if ledger file with same PLAN_HASH_short prefix exists → reconciliation mode
    a. Read pending entries → query Direct by deterministic signature (campaign name prefix + cluster_id metadata) → match found entries get marked committed
    b. Read committed entries → delete via archive+delete
    c. Reset ledger
13. canary_count = max(1, ceil(total_clusters * canary_percent / 100))
14. for cluster in clusters[0..canary_count]:
    For each API mutation:
    a. Write {state:"pending", op:<name>, signature:<deterministic>, cluster_id, ts} to ledger, fsync
    b. Call Direct API
    c. On success: write {state:"committed", op, signature, returned_id, cluster_id, ts} + fsync
    d. On error: write {state:"failed", op, signature, cluster_id, error, ts} + fsync, continue cluster loop
15. After canary phase: compute SYNCHRONOUS API_ERROR_RATE = failed / attempted
    (NOTE: this is NOT moderation success rate — moderation is async and out-of-scope per Phase 3.5.B contract.
    Canary only catches structural API failures: bad payload, missing scope, rate limits.)
16. If API_ERROR_RATE >= abort_on_error_rate:
    STOP, generate canary-report, exit with error code, ledger preserved for recovery.
```

### Stage 2 — Second acknowledgment + bulk continuation

```
17. After canary passes the synchronous-error gate, the pipeline pauses.
    Output canary_report including: cluster IDs created, sample ad URLs in Direct UI, API stats.
    Returns intermediate result {stage: "canary_passed", canary_plan_hash, need_continuation_ack}.
18. Caller must re-invoke with:
    - same plan_hash
    - dry_run: false
    - canary_passed: true
    - continuation_ack: `I-UNDERSTAND-CONTINUE-LIVE:<account.yandex_login>:<PLAN_HASH_first_12>:<canary_committed_ids_count>`
19. Pipeline validates continuation_ack EXACTLY against current state (committed ids count must match canary results)
20. Continue with clusters[canary_count..total]
21. Метrika linking (одним проходом после всех campaigns committed)
22. Generate full report → docs/plans/phase-3-5-c-csv-upload-pipeline/runs/<ts>.md
23. Return final output schema with all created IDs
```

### Lifecycle invariants

- **Every API mutation has 3 ledger entries possible:** pending (before call) → committed (after success) OR failed (after error).
- **Every entry is fsync'd before next API call.** Crash during API commit window still leaves a pending entry that recovery uses to query Direct.
- **Recovery script reconciles pending → committed/failed by querying Direct using deterministic signatures** (campaign names + cluster_id metadata visible in returned objects).
- **Canary measures only synchronous API errors** — moderation rejection is downstream concern, explicitly out of scope, documented clearly.
- **plan_hash binds dry-run plan to live execution.** Any input change → must re-run dry_run.
- **Two-stage gate:** initial acknowledge_live for canary + continuation_ack after canary report. Cannot bulk-upload 50 clusters with a single ack.

## Error handling matrix

| Error | Action |
|---|---|
| CSV not found / parse error | Fail before any API call |
| Cluster has 0 keywords | Skip cluster, log warning |
| Cluster keyword > 4096 chars | Skip cluster, log warning |
| Image URL 404 / >10MB / wrong format | Skip image, use text-only ads for that cluster |
| Campaign create error_code 5004 (limit reached) | Stop, report |
| Adgroup create timeout | Retry once, then skip cluster |
| Keyword add error | Continue with remaining keywords, log per-keyword |
| Ad create error_code 8000 (validation) | Skip variant, log, continue |
| Metrika link error | Continue, drafts created without goals, log |
| Cleanup on crash | try/finally + ledger recovery via separate script |

## Compensating controls

- **dry_run default TRUE** — пользователь должен явно сказать `dry_run: false`
- **canary 10%** — первые 5 кластеров из 50 идут пилотом, потом оценка
- **max_clusters 50** — нельзя одной операцией всадить 200 кампаний
- **abort_on_error_rate 30%** — если ошибок больше — стоп
- **acknowledge_live** требует точного совпадения с computed string (account + site + N clusters)
- **ledger pattern** — durable JSONL log, recovery script `bundle-recovery.ts --ledger <path> --cleanup-only`
- **Все ads — DRAFT-only.** Никаких Ads.moderate. Пользователь сам решает что отправлять.
- **Default bidding strategy = WB_DAILY_BUDGET** — auto-bid с дневным лимитом, безопаснее чем manual CPC

## Acceptance criteria

- [ ] Tool `yandex_direct_upload_campaign_bundle` зарегистрирован в `packages/yandex-seo/src/index.ts`
- [ ] Файлы:
  - `packages/yandex-seo/src/tools/direct-upload-campaign-bundle.ts` — MCP tool entry (~150 строк)
  - `packages/yandex-seo/src/lib/upload-pipeline.ts` — оркестратор (~350 строк)
  - `packages/yandex-seo/src/lib/csv-parser.ts` — Key Collector parser (~80 строк)
  - `packages/yandex-seo/src/lib/bundle-ledger.ts` — ledger управление (~100 строк)
  - `packages/yandex-seo/scripts/bundle-recovery.ts` — standalone cleanup script (~120 строк)
- [ ] dry_run по умолчанию TRUE; явный `dry_run: false` нужен для реальной загрузки
- [ ] confirm-gate включает env-flags + confirm + acknowledge_live
- [ ] Canary mechanism работает: первые `canary_percent%` кластеров → пауза → оценка → продолжение
- [ ] Ledger пишется durable — каждый успешный create → запись в JSONL до следующего API-вызова
- [ ] Recovery script `bundle-recovery.ts` принимает ledger path и чистит всё что записано
- [ ] Live smoke: запуск против vechkasov.ru с test_direct.csv (130 кластеров → ограничено max_clusters=3 для теста) → 3 кампании в DRAFT → cleanup
- [ ] Все Ads.moderate отсутствуют (grep 0 в pipeline + tools)
- [ ] Build pnpm -r build зелёный

## File plan

| File | Status | Lines | Hard cap |
|---|---|---|---|
| `packages/yandex-seo/src/lib/csv-parser.ts` | New | ~80 | 150 |
| `packages/yandex-seo/src/lib/bundle-ledger.ts` | New | ~140 | 250 (pending/committed/failed states + fsync) |
| `packages/yandex-seo/src/lib/payload-builder.ts` | New | ~150 | 250 (Direct API payload builder, bypass B.3 wrappers) |
| `packages/yandex-seo/src/lib/upload-pipeline.ts` | New | ~400 | 550 (now with plan-hash + two-stage gate) |
| `packages/yandex-seo/src/tools/direct-upload-campaign-bundle.ts` | New | ~170 | 280 |
| `packages/yandex-seo/scripts/bundle-recovery.ts` | New | ~150 | 250 (reconciliation by signature) |
| `packages/yandex-seo/scripts/c1-live-smoke.ts` | New | ~200 | 320 |
| `packages/yandex-seo/src/index.ts` | Modify | +10 | — |
| `docs/plans/phase-3-5-c-csv-upload-pipeline/runs/<ts>.md` | Generated | (artifact) | — |
| `docs/plans/phase-3-5-c-csv-upload-pipeline/final-report.md` | Generated | (artifact) | — |

**Итого:** ~980 строк нового TS.

## Architecture decisions

- **Pipeline НЕ использует B.3 typed wrappers напрямую** — известные quirks (WB_DAILY_BUDGET hardcoded в `direct-create-campaign.ts`, неправильное расположение `RegionIds` на уровне кампании вместо группы, отсутствие `Name` в `AdImages.add`, UTC timezone в `StartDate`) делают reuse рискованным. Pipeline использует **generic gateway `executeApiCall`** напрямую с собственным deterministic payload builder в `payload-builder.ts` (~150 строк), который инкорпорирует обходы найденные в b3-live-smoke. Это удлиняет файл, но изолирует pipeline от schema drift в B.3.
- **Контрактные acceptance-тесты** в pipeline проверяют exact payload structure через snapshot: для каждого `campaign_type` × `bidding_strategy_type` есть expected JSON в `__fixtures__/`, тесты в `upload-pipeline.test.ts` проверяют что builder выдаёт именно его.
- **Бизнес-логика — в `upload-pipeline.ts`**, не в MCP-tool. Tool entry — только парсинг входа + delegation. Pipeline тестируется независимо.
- **Ledger — JSONL append-only**, не SQLite. Crash-resistant, легко читается человеком, recovery скрипт парсит line-by-line.
- **Dry-run по умолчанию.** Чтобы пользователь сделал реальную загрузку, нужно явно передать `dry_run: false` — защита от accidental execution.
- **Canary не optional** — даже на 1 кластер canary_percent = 10% округляется до 1, всё равно проходит «pilot stage».
- **CSV parser отделён** — переиспользуется в smoke + Phase 5 если делать кроновый агент.

## Checklist (9 task contracts)

1. **TASK-3560** — `csv-parser.ts` (Key Collector format, 25 columns, cluster grouping, intent extraction, BOM stripping, sha256 file hash). Risk: low.
2. **TASK-3561** — `bundle-ledger.ts` (JSONL append/read with pending/committed/failed states, fsync after each write, signature-based reconciliation). Risk: medium.
3. **TASK-3568** — `payload-builder.ts` (deterministic Direct payload builder with all 4 B.3 quirks pre-fixed: RegionIds on AdGroup level, HIGHEST_POSITION for search, AdImages.add Name field, Moscow timezone). Risk: medium.
4. **TASK-3562** — `upload-pipeline.ts` core orchestrator: plan-hash compute, two-stage gate (canary + continuation_ack), error matrix, fsync'd ledger writes around every API call. Risk: high. Deps: 3560, 3561, 3568.
5. **TASK-3563** — `direct-upload-campaign-bundle.ts` MCP tool entry + register `yandex_direct_upload_campaign_bundle`. Risk: medium. Deps: 3562.
6. **TASK-3564** — `bundle-recovery.ts` standalone reconciliation+cleanup. Read ledger, query Direct by deterministic signatures, mark pending→committed, archive+delete everything owned. Risk: medium. Deps: 3561.
7. **TASK-3565** — `c1-live-smoke.ts` — full lifecycle test on vechkasov.ru with max_clusters=3: dry_run → live with plan_hash → canary report → continuation_ack → completion → recovery script validation → final cleanup. Risk: high. Deps: 3563, 3564.
8. **TASK-3566** — Update `ads-specialist.md`: добавить tool reference + pipeline workflow note. Risk: low. Deps: 3565.
9. **TASK-3567** — Final audit + final-report.md including: contract test results, ledger crash scenarios documented, B.3 wrappers status. Deps: 3566.

**Граф:**

```
3560 ──┐
3561 ──┼──→ 3562 ──→ 3563 ──┐
3568 ──┘    │              │
            └──→ 3564 ─────┴──→ 3565 ──→ 3566 ──→ 3567
```

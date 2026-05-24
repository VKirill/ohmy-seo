# SPEC — pipeline-hardening-v2

## Context & root pattern

Across the fix-direct-pipeline work the recurring defect class was: **the bundle DECLARES a
setting, but the pipeline IGNORES it** (group name, ad variants — fixed; autotargeting,
marker_query — still partial). This SPEC closes the remaining gaps and codifies the
bundle→pipeline contract, plus adds combinatorial RESPONSIVE_AD generation.

Empirically established (canary, live account ki.vech):
- DailyBudget is rejected with auto strategies (Code 6000) → budget via WeeklySpendLimit.
- A combinatorial RESPONSIVE_AD with **7 headlines + 3 texts** is ACCEPTED in a classic RSYA
  TextCampaign via `/json/v501/ads` (no ЕПК required).
- AdImages require exact 1:1 or 16:9 (Code 5004); vertical rejected → already normalized.

Current correct live campaigns (DRAFT, keep): search `710148127`, rsya `710148145`.
Viewable test (keep until user says otherwise): `710148686` ZZZ-COMB-VIEW-скруббер-это.

## Goals (B + C + autotargeting + combinatorics)

### G1 — Autotargeting default-off on search (Часть 2)
The pipeline must DISABLE autotargeting categories on search ad groups.
- After each ad group is created, issue an autotargeting update
  (`buildAutoTargetingUpdatePayload`, method=update, TextAdGroupAutoTargeting.Items).
- If the bundle group declares `AutoTargetingCategories.Items`, apply those verbatim.
- Otherwise, for SEARCH campaigns, default-disable at minimum:
  `BROAD_MATCH`, `ACCESSORY_QUERIES`, `ALTERNATIVE_QUERIES` (Value="NO").
- Failure to apply = warning (do NOT abort the campaign); surface in result.
- RSYA: apply bundle categories if present; no forced default.

### G2 — Combinatorial RESPONSIVE_AD for RSYA (комбинаторка)
Each RSYA ad group gets ONE combinatorial RESPONSIVE_AD with up to **7 headlines + 3 texts**.
- Pool source: bundle group `combinatorial: { headlines[], texts[] }` if present (≤7 / ≤3),
  else DERIVED from the group's ad variants: headlines = unique(Title, Title2) capped 7;
  texts = unique(Text) capped 3.
- Ad mix per RSYA group: keep 1 TGO TextAd (variant A) + 1 combinatorial RESPONSIVE_AD
  (replaces the prior per-variant ResponsiveAd loop). Image hashes attached as today.
- Posted to `/json/v501/ads`. Length limits already valid per field.

### G3 — Bundle contract: marker_query lives in the bundle (B)
- `_meta.marker_query` added to each bundle group YAML (search + rsya), value = the cluster's
  max-«Частотность «[!]»» query (from `Кластеры запросов.csv`).
- Pipeline reads it (buildSyntheticCsv already does via `_meta.marker_query`).
- REMOVE the reupload script's clusters-5.csv marker injection (source of truth = bundle).

### G4 — Schema (B)
`yaml-schema.ts`:
- `_meta.marker_query?: string`.
- group-level optional `combinatorial?: { headlines: string[] (≤7), texts: string[] (≤3) }`.
- AutoTargetingCategories already present — confirm it flows to the pipeline.

## Non-goals
- No ЕПК campaign type (combinatorial works in classic RSYA — proven).
- No DailyBudget for auto strategies (kept reverted).
- No change to search ad variants (distinct A/B/C — already correct).
- No deletion of live/test campaigns in this SPEC's code tasks.

## Acceptance criteria
- AC1: search ad groups created by the pipeline have BROAD_MATCH/ACCESSORY_QUERIES/
  ALTERNATIVE_QUERIES = NO (verified live on re-upload).
- AC2: bundle-declared AutoTargetingCategories are applied verbatim when present.
- AC3: each RSYA group has a combinatorial RESPONSIVE_AD with the derived/declared pool
  (≤7 headlines, ≤3 texts); accepted by Yandex (no Code errors).
- AC4: marker_query is read from the bundle `_meta`; reupload script no longer injects it.
- AC5: schema validates `_meta.marker_query` and optional `combinatorial` pool.
- AC6: tsc 0, full vitest green, new unit tests for autotargeting + combinatorial pool.
- AC7: canary proves autotargeting-off + combinatorial accepted live BEFORE the destructive
  re-upload; final re-upload verify passes (per-group valid ad, weekly budget, marker names).

## Test / rollout strategy
1. Code + unit tests (workers).
2. codex adversarial review of the batch.
3. Canary on a throwaway DRAFT: confirm autotargeting=NO read-back + combinatorial accepted.
4. Re-upload search + rsya (idempotent delete-by-name DRAFT) → verify → final IDs.

## Known tradeoffs
- Combinatorial pool derived from 3 variants yields ≤6 headlines (max 6 unique Title+Title2);
  full 7 needs copywriter-supplied `combinatorial.headlines`. Schema supports it for later.
- Autotargeting update is a separate API call per group (extra calls; warned-not-fatal on error).

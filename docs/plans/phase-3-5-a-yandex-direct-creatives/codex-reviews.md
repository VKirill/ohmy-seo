# Codex Adversarial Reviews — Phase 3.5.A SPEC

## Round 1 (SPEC v1 with validator)

Verdict: needs-attention / major-rework

Findings:
- [CRITICAL] Punctuation rule incorrect — per-field, not blanket exclusion
- [HIGH] Dangling references to `yandex-direct-spec` after deletion
- [HIGH] Bulk CSV → 2+ ads per cluster workflow not in acceptance criteria
- [HIGH] `valid:true` for regulated categories unsafe without preflight
- [MEDIUM] CSV schema safety insufficient

Resolution: User decided to remove client-side validation entirely. Eliminates 4 of 5 findings. Remaining: HIGH on dangling references — addressed by TASK-3507 (global grep + replace).

## Round 2 (SPEC v2 no-validation)

Verdict: needs-attention

Findings:
- [HIGH] SPEC treats Direct upload as sync validation boundary; reality is async + partial moderation
- [HIGH] No canary/batch-size guard for CSV-scale generation (130 clusters → 260-390 ads)

Resolution: Both findings about Phase 3.5.C contract leaking into 3.5.A wording. Patched SPEC Architecture decisions section + cluster-to-campaign-strategy.md content rules to document:
- Direct moderation contract: DRAFT → moderate → MODERATION → ACCEPTED/REJECTED, partial results, possible post-factum revoke
- Batch-risk guidance: canary 5-10% first, hard cap ≤ 100 ads/batch, stop on rejection rate > 30%, stable cluster_id + ad_variant_id

Per orchestrator rules max 2 codex rounds — proceeding to DB insert. Phase 3.5.C SPEC will inherit the contract documented here.

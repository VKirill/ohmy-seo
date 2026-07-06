/**
 * upload-pipeline.ts — CSV → Direct bundle upload orchestrator.
 *
 * Thin barrel: the implementation lives under ./pipeline/. This file re-exports
 * the public surface so existing consumers keep importing from
 * "./upload-pipeline.js" unchanged (move-only refactor — no behavior change).
 *
 * Three stages (see ./pipeline/orchestrator.ts):
 *   Stage 0 (dry_run=true or undefined): plan generation, returns PLAN_HASH + expected_ack_live.
 *   Stage 1 (dry_run=false, plan_hash set, canary_passed undefined): gate + canary run.
 *   Stage 2 (dry_run=false, plan_hash set, canary_passed=true, continuation_ack set): bulk continuation.
 *
 * No Ads.moderate calls — all ads remain DRAFT. User reviews in Direct UI.
 */

export type {
  AdTemplate,
  CampaignStrategy,
  UploadCampaignBundleInput,
  UploadError,
  UploadCampaignBundleOutput,
} from "./pipeline/types.js";

export {
  computePlanHash,
  resolveDailyBudgetMicros,
  pickAdTemplate,
  pickAdTemplatesForCluster,
} from "./pipeline/plan-hash.js";

export { findExistingCampaignId, fetchExistingCampaigns } from "./pipeline/api-utils.js";

export { uploadCampaignBundle } from "./pipeline/orchestrator.js";

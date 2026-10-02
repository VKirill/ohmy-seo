/**
 * pipeline/types.ts — shared types/interfaces for the upload pipeline.
 *
 * Split out of upload-pipeline.ts (move-only refactor). No behavior change.
 */

import { type ClusterRow } from "../csv-parser.js";
import { type Ledger } from "../bundle-ledger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdTemplate {
  cluster_filter?: { intent?: string; cluster_id_pattern?: string };
  variant_label: string;
  title: string;
  title2?: string;
  text: string;
  /**
   * Landing URL for this ad. Optional — falls back to per-group / per-bundle site_url
   * when omitted. Reaches the final Ads.add payload via payload-builder (TASK-4006 / F6).
   */
  href?: string;
  sitelinks?: Array<{ title: string; description?: string; href: string }>;
  callouts?: string[];
}

export type CampaignStrategy =
  | { mode: "one-per-cluster" }
  | {
      mode: "one-per-intent";
      intent_to_campaign: Record<
        "informational" | "transactional" | "branded" | "navigational",
        string
      >;
    }
  | { mode: "single-campaign"; campaign_name: string }
  | {
      /**
       * Multi-campaign bundle: each cluster is assigned to a named campaign by an
       * explicit cluster_id → campaign name map. Distinct campaign names produce
       * distinct Yandex campaigns (created once each, reused by name). Clusters not
       * present in the map fall back to `default_campaign`. Emitted by
       * resolveCampaignStrategy from a bundle's per-group `campaign` fields.
       */
      mode: "cluster-map";
      cluster_to_campaign: Record<string, string>;
      default_campaign: string;
    };

export interface UploadCampaignBundleInput {
  csv_path: string;
  campaign_strategy: CampaignStrategy;
  campaign_type: "search" | "rsya" | "rsya-only";
  site_url: string;
  /**
   * @deprecated Use `daily_budget_amount` instead (raw micros, currency-agnostic).
   * When set, the pipeline multiplies by 1_000_000 to convert RUB to micros.
   * Will be removed in the next minor release.
   */
  daily_budget_rub?: number;
  /**
   * Daily budget expressed in the account's native currency units × 10^6 (micros),
   * exactly as returned by the Yandex Direct API (`DailyBudget.Amount`).
   * Passed through to `buildUnifiedCampaignPayload` as-is — no conversion applied.
   * Preferred over the deprecated `daily_budget_rub` for non-RUB accounts.
   */
  daily_budget_amount?: number;
  /**
   * Per-campaign daily budget override (campaign NAME → micros), for multi-campaign
   * (cluster-map) bundles. When a campaign name has an entry here, its Campaigns.add
   * uses THIS budget instead of the global `daily_budget_amount`. Absent campaigns
   * fall back to the global budget. Optional & backward-compatible: single-campaign
   * bundles never set it. Bound into plan_hash only when non-empty (see plan-hash.ts).
   */
  daily_budget_micros_by_campaign?: Record<string, number>;
  region_ids: number[];
  bidding_strategy_type: "WB_DAILY_BUDGET" | "HIGHEST_POSITION" | "AVERAGE_CPC";
  metrika_counter_ids?: number[];
  metrika_goal_ids?: number[];
  rsya_image_urls?: string[];
  ads_per_group?: number;
  ad_template_strategy: "agent-provided" | "fallback-template";
  ad_templates?: AdTemplate[];
  dry_run?: boolean;
  canary_percent?: number;
  max_clusters?: number;
  abort_on_error_rate?: number;
  confirm?: boolean;
  acknowledge_live?: string;
  account?: string;
  client_login?: string;
  // Stage binding
  plan_hash?: string;
  // Stage 2 continuation
  canary_passed?: boolean;
  continuation_ack?: string;

  /**
   * When true, skip Campaigns.add if a campaign with the same Name already exists
   * for this account; return the existing Id instead. Makes re-runs idempotent.
   * Default: false (create unconditionally — existing behaviour).
   */
  dedupe_by_name?: boolean;

  // Phase 3.5.D F6 wiring — all optional, backwards-compatible

  /**
   * Map of image name → AdImageHash, pre-uploaded by direct-upload-from-yaml.ts.
   * Used to resolve ${img.NAME} template refs in TEXT_IMAGE_AD payloads.
   * When both image_hashes and rsya_image_urls are present, image_hashes takes
   * precedence for YAML-driven ads (rsya_image_urls path is the legacy CSV path).
   */
  image_hashes?: Record<string, string>;

  /**
   * Declared image keys from the bundle's campaign.images definition.
   * When provided, used as the stable image-key input for computePlanHash instead of
   * Object.keys(image_hashes). This ensures dry-run and live plan_hash agree even
   * when some image uploads fail at live time (partial image_hashes != declared keys).
   * Set by direct-upload-from-yaml.ts from Object.keys(bundle.campaign.images ?? {}).
   */
  declared_image_keys?: string[] | null;

  /**
   * SitelinksSet ID created by direct-upload-from-yaml.ts before the pipeline runs.
   * Wired into TextAd.SitelinkSetId/TextImageAd.SitelinkSetId at ad level.
   */
  sitelinks_set_id?: number;

  /**
   * Callout AdExtension IDs created by direct-upload-from-yaml.ts before the pipeline
   * runs. Wired into TextAd.AdExtensionIds / TextImageAd.AdExtensionIds
   * (Direct v5 Ads.add callout IDs attach at ad level).
   * Intentionally NOT part of plan_hash: these IDs are created between dry-run and
   * live, so hashing them would make every live run diverge from its approved plan.
   * The hash binds `callouts` (content) instead.
   */
  callout_ids?: number[];

  /**
   * Campaign-level callout TEXTS — plan_hash content input (mirrors sitelinks_set /
   * promo_extension, which are likewise bound by content, not by live-created id).
   * Editing the bundle's callouts changes the hash and invalidates a stale plan.
   * Set by direct-upload-from-yaml.ts from bundle.campaign.callouts at BOTH stages.
   */
  callouts?: string[];

  /**
   * Per-group SitelinksSet IDs keyed by cluster_id. When a group has an entry here,
   * its ads use THIS id instead of the campaign-level `sitelinks_set_id`.
   * Created by direct-upload-from-yaml.ts (one set per unique sitelinks content).
   */
  sitelinks_set_id_per_group?: Record<string, number>;

  /**
   * Per-group callout AdExtension IDs keyed by cluster_id. When a group has an entry
   * here, its ads use THESE ids instead of the campaign-level `callout_ids`.
   */
  callout_ids_per_group?: Record<string, number[]>;

  /**
   * Per-group AdImageHashes keyed by cluster_id. When a group has an entry here,
   * its combinatorial ad uses THESE image hashes (resolved from the bundle's
   * per-group `${img_key}` refs). Takes precedence over the global `image_hashes`.
   */
  image_hashes_per_group?: Record<string, string[]>;

  /**
   * Per-group sitelinks CONTENT keyed by cluster_id — plan_hash input only.
   * IDs are not known at dry-run time, so the hash binds the content instead:
   * editing a group's sitelinks changes the plan_hash and invalidates stale plans.
   */
  sitelinks_set_per_group?: Record<
    string,
    { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> }
  >;

  /**
   * Per-group callout texts keyed by cluster_id — plan_hash input only (see above).
   */
  callouts_per_group?: Record<string, string[]>;

  /**
   * Legacy field: a verbatim BiddingStrategy from the bundle's TextCampaign block.
   * No longer used for campaign creation — the ЕПК path derives the Search strategy
   * from `bidding_strategy_type`. Kept only so existing callers/bundles still type-check.
   */
  bidding_strategy?: Record<string, unknown>;

  // Phase 3.5.D extensions — all optional, backwards-compatible
  sitelinks_set?: {
    Sitelinks: Array<{ Title: string; Description?: string; Href: string }>;
  };
  promo_extension?: {
    AdExtension: {
      PromoExtension: {
        PromotionType: string;
        Discount?: number;
        DiscountUnit?: string;
        StartDate?: string;
        EndDate: string;
        PromoCode?: string;
        Href?: string;
      };
    };
  };
  tracking_params?: string;
  autotargeting_per_group?: Record<string, Array<{ Category: string; Value: "YES" | "NO" }>>;
  /**
   * Per-group headline/text pools for combinatorial ResponsiveAd creation (RSYA).
   * Key = cluster_id. When present for a group, ONE ResponsiveAd is created using
   * pool.headlines (≤7) + pool.texts (≤3) instead of deriving from ad templates.
   * Set by direct-upload-from-yaml.ts from extractCombinatorialPools(bundle).
   */
  combinatorial_per_group?: Record<string, { headlines: string[]; texts: string[] }>;
  ad_format_mix?: Array<"TEXT_AD" | "TEXT_IMAGE_AD" | "RESPONSIVE_AD">;
  campaign_types?: Array<"TEXT_CAMPAIGN" | "UNIFIED_PERFORMANCE_CAMPAIGN">;
}

export interface UploadError {
  cluster_id: string;
  step: string;
  error: string;
}

export interface UploadCampaignBundleOutput {
  dry_run: boolean;
  total_clusters: number;
  clusters_processed: number;
  campaigns_created: number[];
  ad_groups_created: number[];
  keywords_added: number;
  ads_created: (number | string)[];
  images_uploaded: string[];
  metrika_linked: boolean;
  canary_passed: boolean;
  ledger_path: string;
  errors: UploadError[];
  plan_hash?: string;
  expected_ack_live?: string;
  expected_continuation_ack?: string;
  stage?: string;
  recovery_command: string;
  next_actions: string[];
}

// ---------------------------------------------------------------------------
// Core cluster processing — shared state types (Stage 1 canary + Stage 2 bulk)
// ---------------------------------------------------------------------------

export interface ProcessState {
  campaigns_created: number[];
  ad_groups_created: number[];
  keywords_added: number;
  ads_created: (number | string)[];
  images_uploaded: string[];
  errors: UploadError[];
  attempted: number;
  failed_count: number;
  // Campaign name → campaign_id map (for strategy modes that reuse campaigns)
  campaign_id_by_name: Map<string, number>;
  // Image URL → hash map (upload once, reuse)
  image_hash_by_url: Map<string, string>;
  // Pre-fetched existing campaigns for deduplication (populated once when dedupe_by_name=true)
  existing_campaigns: Array<{ Id: number; Name: string; Status?: string }>;
}

export interface ClusterProcessInput {
  cluster_id: string;
  rows: ClusterRow[];
  state: ProcessState;
  ledger: Ledger;
  input: UploadCampaignBundleInput;
  rsya_image_urls: string[];
  account_label: string | undefined;
  client_login: string | undefined;
}

export interface CreateCampaignArgs {
  cluster_id: string;
  campaignName: string;
  state: ProcessState;
  ledger: Ledger;
  input: UploadCampaignBundleInput;
  account_label: string | undefined;
  client_login: string | undefined;
}

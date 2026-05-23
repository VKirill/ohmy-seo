/**
 * upload-pipeline.ts — CSV → Direct bundle upload orchestrator.
 *
 * Three stages:
 *   Stage 0 (dry_run=true or undefined): plan generation, returns PLAN_HASH + expected_ack_live.
 *   Stage 1 (dry_run=false, plan_hash set, canary_passed undefined): gate + canary run.
 *   Stage 2 (dry_run=false, plan_hash set, canary_passed=true, continuation_ack set): bulk continuation.
 *
 * No Ads.moderate calls — all ads remain DRAFT. User reviews in Direct UI.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { parseKeyCollectorCsv, type ClusterRow } from "./csv-parser.js";
import { openLedger, type Ledger } from "./bundle-ledger.js";
import {
  buildCampaignPayload,
  buildAdGroupPayload,
  buildKeywordPayload,
  buildAdTgoPayload,
  buildResponsiveAdPayload,
  buildImageUploadPayload,
  buildMetrikaUpdatePayload,
} from "./payload-builder.js";
import { executeApiCall } from "./api-gateway.js";
import { requireConfirmGate } from "./api/confirm-gate.js";
import { resolveAccount } from "./account-resolver.js";
import { SCOPES } from "./scopes.js";

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
  | { mode: "single-campaign"; campaign_name: string };

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
   * Passed through to `buildCampaignPayload` as-is — no conversion applied.
   * Preferred over the deprecated `daily_budget_rub` for non-RUB accounts.
   */
  daily_budget_amount?: number;
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
   * Wired into TextAd.SitelinksSetId and TextImageAd.SitelinksSetId at ad level
   * (naming map §3.2/§3.3 — SitelinksSetId is per-ad, not per-campaign).
   */
  sitelinks_set_id?: number;

  /**
   * Callout AdExtension IDs created by direct-upload-from-yaml.ts before the pipeline
   * runs. Wired into TextAd.AdExtensions.Items / TextImageAd.AdExtensions.Items
   * (naming map §5.2 — callouts attach at ad level).
   */
  callout_ids?: number[];

  /**
   * When provided, the BiddingStrategy is forwarded VERBATIM to buildCampaignPayload,
   * bypassing the search/rsya/rsya-only reconstruction logic.
   * Set by direct-upload-from-yaml.ts from bundle.campaign.campaign.TextCampaign.BiddingStrategy.
   * When absent, the existing reconstruction path is used (backwards-compatible for CSV callers).
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
  ads_created: number[];
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
// Internal helpers
// ---------------------------------------------------------------------------

/** Deterministic campaign name for a cluster given the strategy. */
function computeCampaignName(
  cluster_id: string,
  intent: string,
  strategy: CampaignStrategy
): string {
  if (strategy.mode === "single-campaign") {
    return strategy.campaign_name;
  }
  if (strategy.mode === "one-per-intent") {
    const key = intent as keyof typeof strategy.intent_to_campaign;
    return strategy.intent_to_campaign[key] ?? `${intent}-campaign`;
  }
  // one-per-cluster
  return `cluster-${cluster_id}`;
}

/** Get representative intent for a cluster (from first row). */
function clusterIntent(rows: ClusterRow[]): string {
  return rows[0]?.intent ?? "informational";
}

/** Stable JSON serialization: sorts object keys recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]));
  return "{" + pairs.join(",") + "}";
}

/** Compute the plan hash over all deterministic inputs, including ad payload content. */
export function computePlanHash(input: {
  csv_hash: string;
  account_login: string;
  campaign_strategy: CampaignStrategy;
  campaign_type: string;
  site_url: string;
  /** Daily budget in micros (currency-agnostic). Use resolveDailyBudgetMicros() to compute. */
  daily_budget_micros: number;
  region_ids: number[];
  bidding_strategy_type: string;
  metrika_counter_ids?: number[] | null;
  metrika_goal_ids?: number[] | null;
  rsya_image_urls: string[];
  ads_per_group: number;
  canary_percent: number;
  max_clusters: number;
  cluster_count: number;
  campaign_names: string[];
  // Ad content fields — must match between dry_run and live to prevent content substitution
  ad_templates?: AdTemplate[] | null;
  bidding_strategy?: Record<string, unknown> | null;
  sitelinks_set?: { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> } | null;
  promo_extension?: Record<string, unknown> | null;
  callout_ids?: number[] | null;
  image_hashes_keys?: string[] | null;
  dedupe_by_name?: boolean;
}): string {
  const planInput = {
    csv_hash: input.csv_hash,
    account_login: input.account_login,
    campaign_strategy: input.campaign_strategy,
    campaign_type: input.campaign_type,
    site_url: input.site_url,
    daily_budget_micros: input.daily_budget_micros,
    region_ids: [...input.region_ids].sort((a, b) => a - b),
    bidding_strategy_type: input.bidding_strategy_type,
    metrika_counter_ids: input.metrika_counter_ids ?? null,
    metrika_goal_ids: input.metrika_goal_ids ?? null,
    rsya_image_urls: [...input.rsya_image_urls].sort(),
    ads_per_group: input.ads_per_group,
    canary_percent: input.canary_percent,
    max_clusters: input.max_clusters,
    cluster_count: input.cluster_count,
    campaign_names: [...input.campaign_names].sort(),
    // Ad content — bind to prevent dry_run approving one payload, live uploading another
    ad_templates: input.ad_templates ?? null,
    bidding_strategy: input.bidding_strategy ?? null,
    sitelinks_set: input.sitelinks_set ?? null,
    promo_extension: input.promo_extension ?? null,
    callout_ids: input.callout_ids ? [...input.callout_ids].sort((a, b) => a - b) : null,
    image_hashes_keys: input.image_hashes_keys ? [...input.image_hashes_keys].sort() : null,
    dedupe_by_name: input.dedupe_by_name ?? false,
  };
  return crypto.createHash("sha256").update(stableStringify(planInput)).digest("hex");
}

/** Fetch image bytes from URL and return base64 + format. Throws if unusable. */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; format: "JPEG" | "PNG" }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Image URL returned ${resp.status}: ${url}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  const format: "JPEG" | "PNG" = contentType.includes("png") ? "PNG" : "JPEG";
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error(`Image exceeds 10 MB: ${url}`);
  }
  return { base64: buffer.toString("base64"), format };
}

/** Extract numeric ID from a Direct API successful response. */
function extractId(data: unknown): number {
  const result = (data as { result?: { AddResults?: Array<{ Id?: number }> } })?.result
    ?.AddResults?.[0]?.Id;
  if (typeof result !== "number") {
    throw new Error(`Unexpected API response shape: ${JSON.stringify(data)}`);
  }
  return result;
}

/** Extract image hash from a Direct API AdImages.add response. */
function extractImageHash(data: unknown): string {
  const hash = (data as { result?: { AddResults?: Array<{ AdImageHash?: string }> } })?.result
    ?.AddResults?.[0]?.AdImageHash;
  if (typeof hash !== "string") {
    throw new Error(`Unexpected image API response shape: ${JSON.stringify(data)}`);
  }
  return hash;
}

/** Pick an ad template for a given cluster intent + cluster_id. Falls back to first template or generates generic one. */
export function pickAdTemplate(
  cluster_id: string,
  intent: string,
  templates: AdTemplate[] | undefined,
  strategy: "agent-provided" | "fallback-template",
  site_url: string
): Pick<AdTemplate, "title" | "title2" | "text" | "href"> {
  if (strategy === "agent-provided" && templates && templates.length > 0) {
    // Find best match by cluster_id pattern then intent
    const byId = templates.find(
      (t) =>
        t.cluster_filter?.cluster_id_pattern &&
        new RegExp(t.cluster_filter.cluster_id_pattern).test(cluster_id)
    );
    if (byId) return byId;
    const byIntent = templates.find((t) => t.cluster_filter?.intent === intent);
    if (byIntent) return byIntent;
    return templates[0];
  }
  // Fallback template — generic placeholder
  return {
    title: cluster_id.slice(0, 56),
    title2: undefined,
    text: `${cluster_id.slice(0, 75)}. ${site_url}`,
  };
}

/**
 * Return ALL distinct ad templates matching a cluster (preserving bundle order).
 * Mirrors the matching logic of pickAdTemplate but uses .filter instead of .find,
 * so all variants for a cluster are returned (A/B/C, different Title/Title2/Text).
 * Falls back to a single generated placeholder template when none match.
 */
export function pickAdTemplatesForCluster(
  cluster_id: string,
  intent: string,
  templates: AdTemplate[] | undefined,
  strategy: "agent-provided" | "fallback-template",
  site_url: string
): Array<Pick<AdTemplate, "title" | "title2" | "text" | "href">> {
  if (strategy === "agent-provided" && templates && templates.length > 0) {
    // All templates matching by cluster_id pattern (in bundle order)
    const byId = templates.filter(
      (t) =>
        t.cluster_filter?.cluster_id_pattern &&
        new RegExp(t.cluster_filter.cluster_id_pattern).test(cluster_id)
    );
    if (byId.length > 0) return byId;
    // Fall back to intent match
    const byIntent = templates.filter((t) => t.cluster_filter?.intent === intent);
    if (byIntent.length > 0) return byIntent;
    return [templates[0]];
  }
  // Fallback template — single generic placeholder
  return [
    {
      title: cluster_id.slice(0, 56),
      title2: undefined,
      text: `${cluster_id.slice(0, 75)}. ${site_url}`,
    },
  ];
}

/** Ensure directory exists. */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Resolve daily budget in micros from the input.
 * - If `daily_budget_amount` is provided, it is already in micros — use as-is.
 * - Otherwise fall back to the deprecated `daily_budget_rub` multiplied by 1_000_000.
 * Returns micros as a number ready to pass to the Direct API.
 */
export function resolveDailyBudgetMicros(input: Pick<UploadCampaignBundleInput, "daily_budget_amount" | "daily_budget_rub">): number {
  if (input.daily_budget_amount !== undefined) {
    return input.daily_budget_amount;
  }
  return (input.daily_budget_rub ?? 0) * 1_000_000;
}

/**
 * Find an existing campaign by name in a list of campaigns returned by the API.
 * Returns the Id if found and the campaign is in a reusable state, undefined otherwise.
 * Pushes a warning to `warnings` (if provided) when a matched campaign is in a suspicious state.
 * Pure function aside from the optional warnings push.
 */
export function findExistingCampaignId(
  existingCampaigns: Array<{ Id: number; Name: string; Status?: string }>,
  name: string,
  warnings?: Array<{ cluster_id: string; step: string; error: string }>,
  cluster_id?: string
): number | undefined {
  // Filter to non-ARCHIVED campaigns with the matching name
  const nonArchivedMatches = existingCampaigns.filter(
    (c) => c.Name === name && c.Status !== "ARCHIVED"
  );

  if (nonArchivedMatches.length === 0) {
    return undefined;
  }

  // Fail-closed: if multiple non-ARCHIVED campaigns share the same name, refuse to guess
  if (nonArchivedMatches.length > 1) {
    throw new Error(
      `Ambiguous dedupe: ${nonArchivedMatches.length} non-ARCHIVED campaigns named "${name}" ` +
      `(IDs: ${nonArchivedMatches.map((c) => c.Id).join(", ")}). ` +
      `Cannot safely deduplicate — resolve the duplicates in Yandex Direct UI first.`
    );
  }

  const match = nonArchivedMatches[0];

  // Warn on unexpected states (anything other than the normal active/draft states)
  const NORMAL_STATES = new Set(["DRAFT", "ACTIVE", "SUSPENDED", "ENDED", "OFF", "CONVERTED"]);
  if (match.Status !== undefined && !NORMAL_STATES.has(match.Status)) {
    warnings?.push({
      cluster_id: cluster_id ?? "unknown",
      step: "dedupe",
      error: `reusing campaign Id=${match.Id} Name="${name}" in unexpected state "${match.Status}" — verify it is not a stale/failed campaign`,
    });
  }

  return match.Id;
}

/**
 * Fetch all campaigns for the account (Id + Name + Status).
 * Called once before processing clusters when dedupe_by_name=true.
 * Paginates using Page.Limit + Page.Offset until all campaigns are fetched.
 * THROWS on any API error (fail-closed) — a lookup failure must not silently
 * fall back to create (that would produce duplicates).
 *
 * Exported for unit testing only.
 */
export async function fetchExistingCampaigns(
  account_label: string | undefined,
  client_login: string | undefined
): Promise<Array<{ Id: number; Name: string; Status?: string }>> {
  const PAGE_LIMIT = 10000;
  const allCampaigns: Array<{ Id: number; Name: string; Status?: string }> = [];
  let offset = 0;

  for (;;) {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: {},
          FieldNames: ["Id", "Name", "Status"],
          Page: { Limit: PAGE_LIMIT, Offset: offset },
        },
      },
      account: account_label,
      client_login,
    });

    if (!result.ok) {
      throw new Error(
        `fetchExistingCampaigns failed (HTTP ${result.status}): ${JSON.stringify(result.body)}`
      );
    }

    const data = result.data as {
      result?: {
        Campaigns?: Array<{ Id?: number; Name?: string; Status?: string }>;
        LimitedBy?: number;
      };
    };

    const page = (data?.result?.Campaigns ?? []).filter(
      (c): c is { Id: number; Name: string; Status?: string } =>
        typeof c.Id === "number" && typeof c.Name === "string"
    );

    allCampaigns.push(...page);

    const limitedBy = data?.result?.LimitedBy;
    if (limitedBy === undefined || page.length < PAGE_LIMIT) {
      // No more pages
      break;
    }
    offset = limitedBy;
  }

  return allCampaigns;
}

// ---------------------------------------------------------------------------
// Stage 0 — dry-run plan
// ---------------------------------------------------------------------------

async function stage0DryRun(
  input: UploadCampaignBundleInput,
  clusters: Map<string, ClusterRow[]>,
  csvSha256: string,
  totalClusters: number
): Promise<UploadCampaignBundleOutput> {
  const maxClusters = input.max_clusters ?? 50;
  const canaryPercent = input.canary_percent ?? 10;
  const adsPerGroup = input.ads_per_group ?? 3;
  const rsyaImageUrls = input.rsya_image_urls ?? [];

  // Apply intent filter if one-per-intent strategy
  let filteredEntries = [...clusters.entries()];
  if (input.campaign_strategy.mode === "one-per-intent" && input.campaign_strategy.intent_to_campaign) {
    const allowedIntents = Object.keys(input.campaign_strategy.intent_to_campaign);
    filteredEntries = filteredEntries.filter(([, rows]) =>
      allowedIntents.includes(clusterIntent(rows))
    );
  }
  // Apply max_clusters cap
  filteredEntries = filteredEntries.slice(0, maxClusters);

  const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Compute planned campaign names (deduplicated)
  const plannedNamesSet = new Set<string>();
  for (const [cluster_id, rows] of filteredEntries) {
    plannedNamesSet.add(computeCampaignName(cluster_id, clusterIntent(rows), input.campaign_strategy));
  }
  const plannedNames = [...plannedNamesSet].sort();

  const planHash = computePlanHash({
    csv_hash: csvSha256,
    account_login: yandexLogin,
    campaign_strategy: input.campaign_strategy,
    campaign_type: input.campaign_type,
    site_url: input.site_url,
    daily_budget_micros: resolveDailyBudgetMicros(input),
    region_ids: input.region_ids,
    bidding_strategy_type: input.bidding_strategy_type,
    metrika_counter_ids: input.metrika_counter_ids,
    metrika_goal_ids: input.metrika_goal_ids,
    rsya_image_urls: rsyaImageUrls,
    ads_per_group: adsPerGroup,
    canary_percent: canaryPercent,
    max_clusters: maxClusters,
    cluster_count: filteredEntries.length,
    campaign_names: plannedNames,
    ad_templates: input.ad_templates ?? null,
    bidding_strategy: input.bidding_strategy ?? null,
    sitelinks_set: input.sitelinks_set ?? null,
    promo_extension: input.promo_extension ?? null,
    callout_ids: input.callout_ids ?? null,
    image_hashes_keys: input.declared_image_keys !== undefined
      ? (input.declared_image_keys ?? null)
      : (input.image_hashes ? Object.keys(input.image_hashes) : null),
    dedupe_by_name: input.dedupe_by_name ?? false,
  });

  const expectedAckLive = `I-UNDERSTAND-BUNDLE-LIVE:${yandexLogin}:${planHash.slice(0, 12)}`;

  console.log("\n=== UPLOAD PLAN (dry_run=true) ==="); // guardian: allow
  console.log(`Account:         ${yandexLogin}`); // guardian: allow
  console.log(`CSV clusters:    ${totalClusters} total, ${filteredEntries.length} after caps`); // guardian: allow
  console.log(`Campaign type:   ${input.campaign_type}`); // guardian: allow
  console.log(`Strategy:        ${input.campaign_strategy.mode}`); // guardian: allow
  console.log(`Planned campaigns: ${plannedNames.join(", ")}`); // guardian: allow
  console.log(`Canary percent:  ${canaryPercent}% (${Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100))} clusters)`); // guardian: allow
  console.log(`PLAN_HASH:       ${planHash}`); // guardian: allow
  console.log(`\nTo run live:`); // guardian: allow
  console.log(`  dry_run: false`); // guardian: allow
  console.log(`  confirm: true`); // guardian: allow
  console.log(`  acknowledge_live: "${expectedAckLive}"`); // guardian: allow
  console.log(`  plan_hash: "${planHash}"`); // guardian: allow
  console.log("===================================\n"); // guardian: allow

  return {
    dry_run: true,
    total_clusters: totalClusters,
    clusters_processed: 0,
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    metrika_linked: false,
    canary_passed: false,
    ledger_path: "",
    errors: [],
    plan_hash: planHash,
    expected_ack_live: expectedAckLive,
    recovery_command: "",
    next_actions: [
      `Re-call with dry_run=false, confirm=true, acknowledge_live="${expectedAckLive}", plan_hash="${planHash}"`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Core cluster processing — shared by Stage 1 (canary) and Stage 2 (bulk)
// ---------------------------------------------------------------------------

interface ProcessState {
  campaigns_created: number[];
  ad_groups_created: number[];
  keywords_added: number;
  ads_created: number[];
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

interface ClusterProcessInput {
  cluster_id: string;
  rows: ClusterRow[];
  state: ProcessState;
  ledger: Ledger;
  input: UploadCampaignBundleInput;
  rsya_image_urls: string[];
  account_label: string | undefined;
  client_login: string | undefined;
}

interface CreateCampaignArgs {
  cluster_id: string;
  campaignName: string;
  state: ProcessState;
  ledger: Ledger;
  input: UploadCampaignBundleInput;
  account_label: string | undefined;
  client_login: string | undefined;
}

/**
 * Call Campaigns.add for a single campaign.
 * Returns the new campaign Id on success, or undefined on error (error is pushed to state).
 */
async function doCreateCampaign(args: CreateCampaignArgs): Promise<number | undefined> {
  const { cluster_id, campaignName, state, ledger, input, account_label, client_login } = args;
  const campaignSig = `campaign:${campaignName}`;
  const campaignPayload = buildCampaignPayload({
    type: input.campaign_type,
    name: campaignName,
    // Pass micros / 1_000_000 so buildCampaignPayload's internal × 1_000_000 restores the exact micros value.
    daily_budget_rub: resolveDailyBudgetMicros(input) / 1_000_000,
    bidding_strategy_type: input.bidding_strategy_type,
    counter_ids: input.metrika_counter_ids,
    bidding_strategy: input.bidding_strategy,
  });

  await ledger.writePending({ op: "campaign", signature: campaignSig, cluster_id });
  state.attempted++;

  const campResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/campaigns",
    body: campaignPayload,
    account: account_label,
    client_login,
  });

  if (!campResult.ok) {
    const errMsg = JSON.stringify(campResult.body);
    await ledger.writeFailed(campaignSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "campaign_create", error: errMsg });
    const body = campResult.body as { error?: { error_code?: number } };
    if (body?.error?.error_code === 5004) {
      throw new Error("Campaign limit reached (error_code 5004). Stopping pipeline.");
    }
    return undefined;
  }

  let campaign_id: number;
  try {
    campaign_id = extractId(campResult.data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await ledger.writeFailed(campaignSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "campaign_create", error: errMsg });
    return undefined;
  }

  await ledger.writeCommitted(campaignSig, campaign_id);
  state.campaigns_created.push(campaign_id);
  state.campaign_id_by_name.set(campaignName, campaign_id);
  return campaign_id;
}

async function processCluster(opts: ClusterProcessInput): Promise<void> {
  const {
    cluster_id,
    rows,
    state,
    ledger,
    input,
    rsya_image_urls,
    account_label,
    client_login,
  } = opts;

  const intent = clusterIntent(rows);
  const campaignName = computeCampaignName(cluster_id, intent, input.campaign_strategy);

  // Skip empty clusters
  if (rows.length === 0) {
    console.warn(`[SKIP] Cluster ${cluster_id}: 0 keywords`);
    state.errors.push({ cluster_id, step: "keyword_check", error: "0 keywords in cluster" });
    return;
  }

  // Validate keyword lengths
  const validKeywords = rows.filter((r) => {
    if (r.query.length > 4096) {
      state.errors.push({
        cluster_id,
        step: "keyword_check",
        error: `Keyword too long (${r.query.length} chars): ${r.query.slice(0, 80)}`,
      });
      return false;
    }
    return true;
  });

  if (validKeywords.length === 0) {
    state.errors.push({ cluster_id, step: "keyword_check", error: "No valid keywords after length filter" });
    return;
  }

  // ---- Campaign create (or reuse) ----
  let campaign_id: number;

  if (state.campaign_id_by_name.has(campaignName)) {
    campaign_id = state.campaign_id_by_name.get(campaignName)!;
  } else if (input.dedupe_by_name === true) {
    // dedupe_by_name: existing campaigns fetched once before first cluster; reuse if name matches
    const existingId = findExistingCampaignId(state.existing_campaigns, campaignName, state.errors, cluster_id);
    if (existingId !== undefined) {
      console.log(`[DEDUPE] deduped: skip create, reuse Id=${existingId} for "${campaignName}"`); // guardian: allow
      state.campaign_id_by_name.set(campaignName, existingId);
      campaign_id = existingId;
    } else {
      // Name not found in existing — fall through to create
      const created = await doCreateCampaign(
        { cluster_id, campaignName, state, ledger, input, account_label, client_login }
      );
      if (created === undefined) return;
      campaign_id = created;
    }
  } else {
    const created = await doCreateCampaign(
      { cluster_id, campaignName, state, ledger, input, account_label, client_login }
    );
    if (created === undefined) return;
    campaign_id = created;
  }

  // ---- AdGroup create ----
  const markerQuery = rows[0]?.marker_query?.trim() ?? "";
  const adGroupName = (markerQuery.length > 0
    ? markerQuery.slice(0, 255)
    : `adgroup-${cluster_id}`);
  const adGroupSig = `adgroup:${cluster_id}`;
  const adGroupPayload = buildAdGroupPayload({
    campaign_id,
    name: adGroupName,
    region_ids: input.region_ids,
  });

  await ledger.writePending({ op: "ad_group", signature: adGroupSig, cluster_id, parent_id: campaign_id });
  state.attempted++;

  let adGroupResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/adgroups",
    body: adGroupPayload,
    account: account_label,
    client_login,
  });

  // Retry once on timeout
  if (!adGroupResult.ok && adGroupResult.status === 504) {
    adGroupResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adgroups",
      body: adGroupPayload,
      account: account_label,
      client_login,
    });
  }

  if (!adGroupResult.ok) {
    const errMsg = JSON.stringify(adGroupResult.body);
    await ledger.writeFailed(adGroupSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "adgroup_create", error: errMsg });
    return;
  }

  let ad_group_id: number;
  try {
    ad_group_id = extractId(adGroupResult.data);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await ledger.writeFailed(adGroupSig, errMsg);
    state.failed_count++;
    state.errors.push({ cluster_id, step: "adgroup_create", error: errMsg });
    return;
  }

  await ledger.writeCommitted(adGroupSig, ad_group_id, campaign_id);
  state.ad_groups_created.push(ad_group_id);

  // ---- Keywords ----
  for (const kw of validKeywords) {
    const kwSig = `keyword:${cluster_id}:${kw.query.slice(0, 80)}`;
    const kwPayload = buildKeywordPayload({ ad_group_id, keyword_text: kw.query });

    await ledger.writePending({ op: "keyword", signature: kwSig, cluster_id, parent_id: ad_group_id });
    state.attempted++;

    const kwResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      body: kwPayload,
      account: account_label,
      client_login,
    });

    if (!kwResult.ok) {
      const errMsg = JSON.stringify(kwResult.body);
      await ledger.writeFailed(kwSig, errMsg);
      state.failed_count++;
      state.errors.push({ cluster_id, step: "keyword_add", error: `keyword="${kw.query.slice(0, 40)}": ${errMsg}` });
      // Continue with remaining keywords per error matrix
    } else {
      try {
        const kw_id = extractId(kwResult.data);
        await ledger.writeCommitted(kwSig, kw_id, ad_group_id);
        state.keywords_added++;
      } catch {
        await ledger.writeFailed(kwSig, "id_extraction_failed");
        state.failed_count++;
      }
    }
  }

  // ---- Ads ----
  const adsPerGroup = input.ads_per_group ?? 3;
  const adTemplates = pickAdTemplatesForCluster(
    cluster_id,
    intent,
    input.ad_templates,
    input.ad_template_strategy,
    input.site_url
  );

  const isRsya = input.campaign_type === "rsya" || input.campaign_type === "rsya-only";

  // TGO ads (search or rsya with text) — one ad per distinct template, capped at ads_per_group
  const adCount = Math.min(adsPerGroup, isRsya ? 1 : adTemplates.length);
  for (let i = 0; i < adCount; i++) {
    const tmpl = adTemplates[i];
    const adSig = `ad_tgo:${cluster_id}:v${i}`;
    const adPayload = buildAdTgoPayload({
      ad_group_id,
      title: tmpl.title,
      title2: tmpl.title2,
      text: tmpl.text,
      href: tmpl.href ?? input.site_url,
      sitelinks_set_id: input.sitelinks_set_id,
      ad_extensions: input.callout_ids,
    });

    await ledger.writePending({ op: "ad_tgo", signature: adSig, cluster_id, parent_id: ad_group_id });
    state.attempted++;

    const adResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/ads",
      body: adPayload,
      account: account_label,
      client_login,
    });

    if (!adResult.ok) {
      const errMsg = JSON.stringify(adResult.body);
      await ledger.writeFailed(adSig, errMsg);
      state.failed_count++;
      // All ad errors are surfaced in state.errors (including code 8000 validation errors)
      state.errors.push({ cluster_id, step: "ad_create", error: errMsg });
    } else {
      const addResults = (adResult.data as { result?: { AddResults?: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }> } })
        ?.result?.AddResults;
      const firstResult = addResults?.[0];
      if (firstResult?.Id !== undefined) {
        const ad_id = firstResult.Id;
        await ledger.writeCommitted(adSig, ad_id, ad_group_id);
        state.ads_created.push(ad_id);
      } else if (firstResult?.Errors && firstResult.Errors.length > 0) {
        // Surface item-level Direct API errors (HTTP 200 but item failed)
        const itemErrMsg = JSON.stringify(firstResult.Errors);
        await ledger.writeFailed(adSig, itemErrMsg);
        state.failed_count++;
        state.errors.push({ cluster_id, step: "ad_create", error: itemErrMsg });
      } else {
        await ledger.writeFailed(adSig, "id_extraction_failed");
        state.failed_count++;
      }
    }
  }

  // RSYA image ads — try image_hashes (YAML-driven) first, then rsya_image_urls (legacy CSV path)
  // Creates ResponsiveAd via /json/v501/ads (v5 returns error 3500 for ResponsiveAd).
  // Tolerates per-image rejection (e.g. Code 5004 for wrong aspect ratio): skips rejected images,
  // proceeds with any successfully uploaded hashes. Falls back to text-only if 0 hashes succeed.
  const hasImageHashes = input.image_hashes && Object.keys(input.image_hashes).length > 0;
  if (isRsya && (hasImageHashes || rsya_image_urls.length > 0)) {
    const collectedHashes: string[] = [];

    if (hasImageHashes) {
      // YAML-driven path: all pre-uploaded hashes are already available — use up to 5
      const hashValues = Object.values(input.image_hashes!);
      for (const h of hashValues) {
        if (h && !collectedHashes.includes(h)) {
          collectedHashes.push(h);
        }
        if (collectedHashes.length >= 5) break;
      }
      for (const h of collectedHashes) {
        if (!state.images_uploaded.includes(h)) {
          state.images_uploaded.push(h);
        }
      }
    } else {
      // Legacy CSV path: upload images from URLs on demand; tolerate per-image rejection
      for (const imageUrl of rsya_image_urls) {
        if (collectedHashes.length >= 5) break;

        // Upload image once per URL (cache)
        const cachedHash = state.image_hash_by_url.get(imageUrl);
        if (cachedHash) {
          if (!collectedHashes.includes(cachedHash)) collectedHashes.push(cachedHash);
          continue;
        }

        try {
          const { base64, format } = await fetchImageAsBase64(imageUrl);
          const imgSig = `image:${imageUrl.slice(0, 80)}`;
          const imgPayload = buildImageUploadPayload({ base64, format });

          await ledger.writePending({ op: "image", signature: imgSig, cluster_id });
          state.attempted++;

          const imgResult = await executeApiCall({
            apiName: "direct",
            endpoint: "/json/v5/adimages",
            body: imgPayload,
            account: account_label,
            client_login,
          });

          if (!imgResult.ok) {
            const errMsg = JSON.stringify(imgResult.body);
            await ledger.writeFailed(imgSig, errMsg);
            state.failed_count++;
            // Tolerate: log warning but continue collecting other hashes
            state.errors.push({ cluster_id, step: "image_upload", error: `url=${imageUrl.slice(0, 60)}: ${errMsg}` });
          } else {
            // Check for item-level errors (e.g. Code 5004 — wrong aspect ratio)
            const imgAddResult = (imgResult.data as { result?: { AddResults?: Array<{ AdImageHash?: string; Errors?: Array<{ Code: number; Message: string }> }> } })
              ?.result?.AddResults?.[0];
            if (imgAddResult?.Errors && imgAddResult.Errors.length > 0) {
              const itemErrMsg = JSON.stringify(imgAddResult.Errors);
              await ledger.writeFailed(imgSig, itemErrMsg);
              // Tolerate per-image rejection: warn and continue
              state.errors.push({ cluster_id, step: "image_upload", error: `url=${imageUrl.slice(0, 60)} rejected: ${itemErrMsg}` });
            } else {
              const uploadedHash = extractImageHash(imgResult.data);
              await ledger.writeCommitted(imgSig, uploadedHash);
              state.image_hash_by_url.set(imageUrl, uploadedHash);
              state.images_uploaded.push(uploadedHash);
              if (!collectedHashes.includes(uploadedHash)) collectedHashes.push(uploadedHash);
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          state.errors.push({ cluster_id, step: "image_upload", error: errMsg });
          // Fall through to next URL
        }
      }
    }

    // RSYA ResponsiveAd with images (if ≥1 hash succeeded), via /json/v501/ads
    // One ResponsiveAd per distinct template variant starting at tgoCount (offset past TGO ads),
    // so each variant is used at most once across TGO + ResponsiveAd ads.
    if (collectedHashes.length > 0) {
      // tgoCount = number of TGO ads already created above (1 for RSYA)
      const tgoCount = adCount;
      const rsyaCount = Math.max(0, Math.min(adsPerGroup - tgoCount, adTemplates.length - tgoCount));
      for (let i = 0; i < rsyaCount; i++) {
        const rsyaTmpl = adTemplates[tgoCount + i];
        // Build Titles: use title as first entry; add title2 as second if present
        const titles: string[] = [rsyaTmpl.title];
        if (rsyaTmpl.title2) titles.push(rsyaTmpl.title2);
        const rsyaSig = `ad_rsya:${cluster_id}:v${tgoCount + i}`;
        const rsyaPayload = buildResponsiveAdPayload({
          ad_group_id,
          Titles: titles,
          Texts: [rsyaTmpl.text],
          Href: rsyaTmpl.href ?? input.site_url,
          AdImageHashes: collectedHashes,
          SitelinkSetId: input.sitelinks_set_id,
          AdExtensionIds: input.callout_ids,
        });

        await ledger.writePending({ op: "ad_rsya", signature: rsyaSig, cluster_id, parent_id: ad_group_id });
        state.attempted++;

        const rsyaResult = await executeApiCall({
          apiName: "direct",
          endpoint: "/json/v501/ads",
          body: rsyaPayload,
          account: account_label,
          client_login,
        });

        if (!rsyaResult.ok) {
          const errMsg = JSON.stringify(rsyaResult.body);
          await ledger.writeFailed(rsyaSig, errMsg);
          state.failed_count++;
          // Surface HTTP-level errors in state.errors (mirroring TGO path)
          state.errors.push({ cluster_id, step: "ad_rsya_create", error: errMsg });
        } else {
          const rsyaAddResults = (rsyaResult.data as { result?: { AddResults?: Array<{ Id?: number; Errors?: Array<{ Code: number; Message: string }> }> } })
            ?.result?.AddResults;
          const rsyaFirstResult = rsyaAddResults?.[0];
          if (rsyaFirstResult?.Id !== undefined) {
            const ad_id = rsyaFirstResult.Id;
            await ledger.writeCommitted(rsyaSig, ad_id, ad_group_id);
            state.ads_created.push(ad_id);
          } else if (rsyaFirstResult?.Errors && rsyaFirstResult.Errors.length > 0) {
            // Surface item-level Direct API errors (HTTP 200 but item failed)
            const itemErrMsg = JSON.stringify(rsyaFirstResult.Errors);
            await ledger.writeFailed(rsyaSig, itemErrMsg);
            state.failed_count++;
            state.errors.push({ cluster_id, step: "ad_rsya_create", error: itemErrMsg });
          } else {
            await ledger.writeFailed(rsyaSig, "id_extraction_failed");
            state.failed_count++;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stage 1 — gate + canary
// ---------------------------------------------------------------------------

async function stage1Canary(
  input: UploadCampaignBundleInput,
  filteredEntries: [string, ClusterRow[]][],
  totalClusters: number,
  planHash: string,
  expectedAckLive: string,
  acc: { label: string; id: number; yandex_login: string | null }
): Promise<UploadCampaignBundleOutput> {
  const canaryPercent = input.canary_percent ?? 10;
  const abortOnErrorRate = input.abort_on_error_rate ?? 0.3;

  // Validate plan_hash binding
  if (!input.plan_hash) {
    throw new Error("plan_hash is required for live execution. Re-run with dry_run=true to get plan_hash.");
  }
  if (input.plan_hash !== planHash) {
    throw new Error(
      `plan_hash mismatch — inputs changed since dry-run. ` +
      `Expected: ${planHash}. Got: ${input.plan_hash}. Re-run dry_run=true to get a fresh plan_hash.`
    );
  }

  // Confirm gate
  requireConfirmGate(
    { confirm: input.confirm, acknowledge_live: input.acknowledge_live },
    { expectedAck: expectedAckLive }
  );

  // Open ledger
  const yandexLogin = acc.yandex_login ?? acc.label;
  const ts = Date.now();
  const ledgerDir = path.resolve(
    path.join(process.cwd(), "packages/yandex-seo/data")
  );
  ensureDir(ledgerDir);
  const ledgerPath = path.join(ledgerDir, `bundle-ledger-${planHash.slice(0, 12)}-${ts}.jsonl`);
  const ledger = await openLedger(ledgerPath);

  // Pre-fetch existing campaigns once if dedupe_by_name is enabled
  const existingCampaigns = input.dedupe_by_name === true
    ? await fetchExistingCampaigns(input.account, undefined)
    : [];

  const state: ProcessState = {
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    errors: [],
    attempted: 0,
    failed_count: 0,
    campaign_id_by_name: new Map(),
    image_hash_by_url: new Map(),
    existing_campaigns: existingCampaigns,
  };

  const rsyaImageUrls = input.rsya_image_urls ?? [];
  const canaryCount = Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100));
  const canarySlice = filteredEntries.slice(0, canaryCount);

  try {
    for (const [cluster_id, rows] of canarySlice) {
      try {
        await processCluster({
          cluster_id,
          rows,
          state,
          ledger,
          input,
          rsya_image_urls: rsyaImageUrls,
          account_label: input.account,
          client_login: undefined,
        });
      } catch (err) {
        // Campaign limit or hard stop
        const errMsg = err instanceof Error ? err.message : String(err);
        state.errors.push({ cluster_id, step: "cluster_loop", error: errMsg });
        break;
      }
    }
  } finally {
    await ledger.close();
  }

  // Error rate check
  const errorRate = state.attempted > 0 ? state.failed_count / state.attempted : 0;

  if (errorRate >= abortOnErrorRate) {
    return {
      dry_run: false,
      total_clusters: totalClusters,
      clusters_processed: canaryCount,
      campaigns_created: state.campaigns_created,
      ad_groups_created: state.ad_groups_created,
      keywords_added: state.keywords_added,
      ads_created: state.ads_created,
      images_uploaded: state.images_uploaded,
      metrika_linked: false,
      canary_passed: false,
      ledger_path: ledgerPath,
      errors: state.errors,
      stage: "canary_aborted",
      recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      next_actions: [
        `Canary error rate ${(errorRate * 100).toFixed(1)}% >= threshold ${(abortOnErrorRate * 100).toFixed(1)}%. Review errors above.`,
        `To clean up: npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      ],
    };
  }

  // Count committed ledger entries — must match what stage2Continuation will read from the same ledger.
  // Read from ledger directly (not from in-memory state) so that pre-uploaded images passed via
  // image_hashes (which are not written to the ledger) are excluded from the count.
  const allLedgerEntries = await ledger.readAll();
  const committedCount = allLedgerEntries.filter((e) => e.state === "committed").length;
  const expectedContinuationAck = `I-UNDERSTAND-CONTINUE-LIVE:${yandexLogin}:${planHash.slice(0, 12)}:${committedCount}`;

  console.log("\n=== CANARY PASSED ==="); // guardian: allow
  console.log(`Clusters processed: ${canaryCount} / ${filteredEntries.length}`); // guardian: allow
  console.log(`Campaigns created:  ${state.campaigns_created.join(", ") || "(none)"}`); // guardian: allow
  console.log(`Error rate:         ${(errorRate * 100).toFixed(1)}%`); // guardian: allow
  console.log(`Ledger:             ${ledgerPath}`); // guardian: allow
  console.log(`\nTo continue:`); // guardian: allow
  console.log(`  canary_passed: true`); // guardian: allow
  console.log(`  continuation_ack: "${expectedContinuationAck}"`); // guardian: allow
  console.log("====================\n"); // guardian: allow

  return {
    dry_run: false,
    total_clusters: totalClusters,
    clusters_processed: canaryCount,
    campaigns_created: state.campaigns_created,
    ad_groups_created: state.ad_groups_created,
    keywords_added: state.keywords_added,
    ads_created: state.ads_created,
    images_uploaded: state.images_uploaded,
    metrika_linked: false,
    canary_passed: true,
    ledger_path: ledgerPath,
    errors: state.errors,
    stage: "canary_passed",
    expected_continuation_ack: expectedContinuationAck,
    recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
    next_actions: [
      `Canary passed (${canaryCount} clusters, ${state.campaigns_created.length} campaigns created).`,
      `Check campaigns in Direct UI, then re-call with canary_passed=true, continuation_ack="${expectedContinuationAck}"`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — bulk continuation
// ---------------------------------------------------------------------------

async function stage2Continuation(
  input: UploadCampaignBundleInput,
  filteredEntries: [string, ClusterRow[]][],
  totalClusters: number,
  planHash: string,
  acc: { label: string; id: number; yandex_login: string | null }
): Promise<UploadCampaignBundleOutput> {
  const canaryPercent = input.canary_percent ?? 10;
  const canaryCount = Math.max(1, Math.ceil(filteredEntries.length * canaryPercent / 100));
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Find the canary ledger — look for matching plan_hash prefix file
  const dataDir = path.resolve(path.join(process.cwd(), "packages/yandex-seo/data"));
  const prefix = `bundle-ledger-${planHash.slice(0, 12)}-`;
  let ledgerPath: string;

  if (fs.existsSync(dataDir)) {
    const existing = fs.readdirSync(dataDir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .reverse(); // most recent first
    if (existing.length > 0) {
      ledgerPath = path.join(dataDir, existing[0]);
    } else {
      ledgerPath = path.join(dataDir, `bundle-ledger-${planHash.slice(0, 12)}-${Date.now()}.jsonl`);
    }
  } else {
    ensureDir(dataDir);
    ledgerPath = path.join(dataDir, `bundle-ledger-${planHash.slice(0, 12)}-${Date.now()}.jsonl`);
  }

  const ledger = await openLedger(ledgerPath);

  // Read committed entries from canary to rebuild state
  const priorEntries = await ledger.readAll();
  const committedPrior = priorEntries.filter((e) => e.state === "committed");
  const priorCommittedCount = committedPrior.length;

  // Validate continuation_ack
  const expectedContinuationAck = `I-UNDERSTAND-CONTINUE-LIVE:${yandexLogin}:${planHash.slice(0, 12)}:${priorCommittedCount}`;
  if (input.continuation_ack !== expectedContinuationAck) {
    await ledger.close();
    throw new Error(
      `continuation_ack mismatch. Expected: "${expectedContinuationAck}". ` +
      `Got: "${input.continuation_ack}". The committed count (${priorCommittedCount}) must match canary results.`
    );
  }

  // Pre-fetch existing campaigns once if dedupe_by_name is enabled
  const existingCampaignsStage2 = input.dedupe_by_name === true
    ? await fetchExistingCampaigns(input.account, undefined)
    : [];

  // Restore state from prior ledger entries
  const state: ProcessState = {
    campaigns_created: [],
    ad_groups_created: [],
    keywords_added: 0,
    ads_created: [],
    images_uploaded: [],
    errors: [],
    attempted: 0,
    failed_count: 0,
    campaign_id_by_name: new Map(),
    image_hash_by_url: new Map(),
    existing_campaigns: existingCampaignsStage2,
  };

  // Rebuild campaign_id_by_name from prior committed entries
  for (const entry of committedPrior) {
    if (entry.op === "campaign" && typeof entry.returned_id === "number") {
      const sig = entry.signature; // "campaign:<name>"
      const nameFromSig = sig.replace(/^campaign:/, "");
      state.campaign_id_by_name.set(nameFromSig, entry.returned_id);
      state.campaigns_created.push(entry.returned_id);
    } else if (entry.op === "ad_group" && typeof entry.returned_id === "number") {
      state.ad_groups_created.push(entry.returned_id);
    } else if (entry.op === "keyword") {
      state.keywords_added++;
    } else if ((entry.op === "ad_tgo" || entry.op === "ad_rsya") && typeof entry.returned_id === "number") {
      state.ads_created.push(entry.returned_id);
    } else if (entry.op === "image" && typeof entry.returned_id === "string") {
      state.images_uploaded.push(entry.returned_id);
    }
  }

  const rsyaImageUrls = input.rsya_image_urls ?? [];
  const bulkSlice = filteredEntries.slice(canaryCount);

  try {
    for (const [cluster_id, rows] of bulkSlice) {
      try {
        await processCluster({
          cluster_id,
          rows,
          state,
          ledger,
          input,
          rsya_image_urls: rsyaImageUrls,
          account_label: input.account,
          client_login: undefined,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        state.errors.push({ cluster_id, step: "cluster_loop", error: errMsg });
        break;
      }
    }

    // Stage 2 error rate check — mirrors Stage 1 canary abort logic
    const abortOnErrorRate = input.abort_on_error_rate ?? 0.3;
    const bulkErrorRate = state.attempted > 0 ? state.failed_count / state.attempted : 0;
    if (bulkErrorRate >= abortOnErrorRate) {
      return {
        dry_run: false,
        total_clusters: totalClusters,
        clusters_processed: canaryCount + bulkSlice.length,
        campaigns_created: state.campaigns_created,
        ad_groups_created: state.ad_groups_created,
        keywords_added: state.keywords_added,
        ads_created: state.ads_created,
        images_uploaded: state.images_uploaded,
        metrika_linked: false,
        canary_passed: true,
        ledger_path: ledgerPath,
        errors: state.errors,
        stage: "bulk_aborted",
        recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
        next_actions: [
          `Bulk error rate ${(bulkErrorRate * 100).toFixed(1)}% >= threshold ${(abortOnErrorRate * 100).toFixed(1)}%. Campaign bundle is INCOMPLETE.`,
          `Review errors above, then run recovery: npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
        ],
      };
    }

    // Metrika linking
    let metrikaLinked = false;
    if (input.metrika_counter_ids && input.metrika_goal_ids && input.metrika_counter_ids.length > 0 && input.metrika_goal_ids.length > 0) {
      const strategyType = input.bidding_strategy_type === "WB_DAILY_BUDGET"
        ? "WB_DAILY_BUDGET"
        : input.bidding_strategy_type === "AVERAGE_CPC"
        ? "WB_DAILY_BUDGET"  // fallback to WB for metrika linking
        : "WB_DAILY_BUDGET";

      for (const campaign_id of state.campaigns_created) {
        try {
          const metrikaPayload = buildMetrikaUpdatePayload({
            campaign_id,
            counter_ids: input.metrika_counter_ids,
            goal_ids: input.metrika_goal_ids,
            strategy_type: strategyType,
          });
          const metrikaResult = await executeApiCall({
            apiName: "direct",
            endpoint: "/json/v5/campaigns",
            method: "POST",
            body: metrikaPayload,
            account: input.account,
          });
          if (!metrikaResult.ok) {
            const errMsg = JSON.stringify(metrikaResult.body);
            state.errors.push({ cluster_id: `campaign:${campaign_id}`, step: "metrika_link", error: errMsg });
          } else {
            metrikaLinked = true;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          state.errors.push({ cluster_id: `campaign:${campaign_id}`, step: "metrika_link", error: errMsg });
          // Continue per error matrix — drafts created without goals
        }
      }
    }

    // Generate report
    const runsDir = path.resolve(
      path.join(process.cwd(), "docs/plans/phase-3-5-c-csv-upload-pipeline/runs")
    );
    ensureDir(runsDir);
    const reportTs = new Date().toISOString().replace(/[:.]/g, "-");
    const reportPath = path.join(runsDir, `${planHash.slice(0, 12)}-${reportTs}.md`);
    const reportContent = [
      `# Upload Report`,
      ``,
      `- **Plan hash:** ${planHash}`,
      `- **Account:** ${yandexLogin}`,
      `- **Timestamp:** ${new Date().toISOString()}`,
      `- **Total clusters:** ${totalClusters}`,
      `- **Clusters processed:** ${canaryCount + bulkSlice.length}`,
      `- **Campaigns created:** ${state.campaigns_created.length} (IDs: ${state.campaigns_created.join(", ")})`,
      `- **Ad groups created:** ${state.ad_groups_created.length}`,
      `- **Keywords added:** ${state.keywords_added}`,
      `- **Ads created:** ${state.ads_created.length}`,
      `- **Images uploaded:** ${state.images_uploaded.join(", ") || "none"}`,
      `- **Metrika linked:** ${metrikaLinked}`,
      `- **Errors:** ${state.errors.length}`,
      ``,
      `## Error Details`,
      ``,
      state.errors.length === 0
        ? "_No errors._"
        : state.errors.map((e) => `- **${e.step}** (cluster ${e.cluster_id}): ${e.error}`).join("\n"),
      ``,
      `## Ledger`,
      ``,
      `\`${ledgerPath}\``,
      ``,
      `## Recovery`,
      ``,
      `\`npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"\``,
    ].join("\n");

    fs.writeFileSync(reportPath, reportContent, "utf-8");
    console.log(`\nReport written: ${reportPath}`); // guardian: allow

    return {
      dry_run: false,
      total_clusters: totalClusters,
      clusters_processed: canaryCount + bulkSlice.length,
      campaigns_created: state.campaigns_created,
      ad_groups_created: state.ad_groups_created,
      keywords_added: state.keywords_added,
      ads_created: state.ads_created,
      images_uploaded: state.images_uploaded,
      metrika_linked: metrikaLinked,
      canary_passed: true,
      ledger_path: ledgerPath,
      errors: state.errors,
      stage: "completed",
      recovery_command: `npx tsx scripts/bundle-recovery.ts --ledger "${ledgerPath}"`,
      next_actions: [
        `Bundle upload complete. Review campaigns in Yandex Direct UI.`,
        `All ads are in DRAFT state — review and send for moderation manually.`,
        ...(metrikaLinked ? [] : [`Metrika linking failed or not configured — link goals manually.`]),
      ],
    };
  } finally {
    await ledger.close();
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function uploadCampaignBundle(
  input: UploadCampaignBundleInput
): Promise<UploadCampaignBundleOutput> {
  // Parse CSV
  const csv = parseKeyCollectorCsv(input.csv_path);
  const { clusters, sha256: csvSha256, total_clusters: totalClusters } = csv;

  const maxClusters = input.max_clusters ?? 50;
  const canaryPercent = input.canary_percent ?? 10;
  const adsPerGroup = input.ads_per_group ?? 3;
  const rsyaImageUrls = input.rsya_image_urls ?? [];

  // Apply intent filter if one-per-intent strategy
  let filteredEntries = [...clusters.entries()];
  if (
    input.campaign_strategy.mode === "one-per-intent" &&
    input.campaign_strategy.intent_to_campaign
  ) {
    const allowedIntents = Object.keys(input.campaign_strategy.intent_to_campaign);
    filteredEntries = filteredEntries.filter(([, rows]) =>
      allowedIntents.includes(clusterIntent(rows))
    );
  }
  // Apply max_clusters cap
  filteredEntries = filteredEntries.slice(0, maxClusters);

  // Resolve account
  const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
  const yandexLogin = acc.yandex_login ?? acc.label;

  // Compute planned campaign names
  const plannedNamesSet = new Set<string>();
  for (const [cluster_id, rows] of filteredEntries) {
    plannedNamesSet.add(
      computeCampaignName(cluster_id, clusterIntent(rows), input.campaign_strategy)
    );
  }
  const plannedNames = [...plannedNamesSet];

  // Compute PLAN_HASH
  const planHash = computePlanHash({
    csv_hash: csvSha256,
    account_login: yandexLogin,
    campaign_strategy: input.campaign_strategy,
    campaign_type: input.campaign_type,
    site_url: input.site_url,
    daily_budget_micros: resolveDailyBudgetMicros(input),
    region_ids: input.region_ids,
    bidding_strategy_type: input.bidding_strategy_type,
    metrika_counter_ids: input.metrika_counter_ids,
    metrika_goal_ids: input.metrika_goal_ids,
    rsya_image_urls: rsyaImageUrls,
    ads_per_group: adsPerGroup,
    canary_percent: canaryPercent,
    max_clusters: maxClusters,
    cluster_count: filteredEntries.length,
    campaign_names: plannedNames,
    ad_templates: input.ad_templates ?? null,
    bidding_strategy: input.bidding_strategy ?? null,
    sitelinks_set: input.sitelinks_set ?? null,
    promo_extension: input.promo_extension ?? null,
    callout_ids: input.callout_ids ?? null,
    image_hashes_keys: input.declared_image_keys !== undefined
      ? (input.declared_image_keys ?? null)
      : (input.image_hashes ? Object.keys(input.image_hashes) : null),
    dedupe_by_name: input.dedupe_by_name ?? false,
  });

  const expectedAckLive = `I-UNDERSTAND-BUNDLE-LIVE:${yandexLogin}:${planHash.slice(0, 12)}`;

  // Stage detection
  const isDryRun = input.dry_run !== false; // default true
  const isContinuation =
    input.dry_run === false && input.plan_hash !== undefined && input.canary_passed === true;

  if (isDryRun) {
    return stage0DryRun(input, clusters, csvSha256, totalClusters);
  }

  if (isContinuation) {
    return stage2Continuation(input, filteredEntries, totalClusters, planHash, acc);
  }

  // Stage 1 — canary
  return stage1Canary(input, filteredEntries, totalClusters, planHash, expectedAckLive, acc);
}

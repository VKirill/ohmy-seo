/**
 * pipeline/plan-hash.ts — deterministic planning helpers: campaign naming,
 * daily-budget resolution, plan_hash computation, and ad-template selection.
 *
 * Split out of upload-pipeline.ts (move-only refactor). No behavior change.
 */

import * as crypto from "crypto";

import { type ClusterRow } from "../csv-parser.js";
import type { AdTemplate, CampaignStrategy, UploadCampaignBundleInput } from "./types.js";

/** Deterministic campaign name for a cluster given the strategy. */
export function computeCampaignName(
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
  if (strategy.mode === "cluster-map") {
    return strategy.cluster_to_campaign[cluster_id] ?? strategy.default_campaign;
  }
  // one-per-cluster
  return `cluster-${cluster_id}`;
}

/** Get representative intent for a cluster (from first row). */
export function clusterIntent(rows: ClusterRow[]): string {
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
  /** Campaign-level callout texts. Live-created callout_ids are NOT hashed (see UploadCampaignBundleInput). */
  callouts?: string[] | null;
  image_hashes_keys?: string[] | null;
  dedupe_by_name?: boolean;
  // Per-group extension CONTENT (not IDs — IDs don't exist at dry-run time)
  sitelinks_set_per_group?: Record<
    string,
    { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> }
  > | null;
  callouts_per_group?: Record<string, string[]> | null;
  /** Per-campaign budget overrides (name → micros). Bound only when non-empty so
   *  single-campaign bundles keep their historical hash byte-for-byte. */
  daily_budget_micros_by_campaign?: Record<string, number> | null;
}): string {
  const planInput: Record<string, unknown> = {
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
    // Callouts bound by CONTENT. Live-created IDs (callout_ids, sitelinks_set_id,
    // promo_extension_id, per-group id maps) are deliberately excluded — they don't
    // exist at dry-run time and would break dry-run/live hash agreement.
    callouts: input.callouts ?? null,
    image_hashes_keys: input.image_hashes_keys ? [...input.image_hashes_keys].sort() : null,
    dedupe_by_name: input.dedupe_by_name ?? false,
    // Per-group extension content — stableStringify sorts record keys, so group order is irrelevant
    sitelinks_set_per_group: input.sitelinks_set_per_group ?? null,
    callouts_per_group: input.callouts_per_group ?? null,
  };
  // Additive: only present for multi-campaign bundles with per-campaign budgets.
  // Omitting the key entirely when absent keeps single-campaign hashes unchanged.
  if (input.daily_budget_micros_by_campaign && Object.keys(input.daily_budget_micros_by_campaign).length > 0) {
    planInput.daily_budget_micros_by_campaign = input.daily_budget_micros_by_campaign;
  }
  return crypto.createHash("sha256").update(stableStringify(planInput)).digest("hex");
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

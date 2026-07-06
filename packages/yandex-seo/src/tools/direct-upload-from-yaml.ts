import { z } from "zod";
import { loadCampaignFolder, resolveRefs } from "../lib/yaml-loader.js";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildSitelinksSetPayload, buildPromoExtensionPayload, buildCalloutPayload } from "../lib/payload-builder.js";
import { uploadCampaignBundle, type AdTemplate, type CampaignStrategy } from "../lib/upload-pipeline.js";
import { runDirectUploadImage } from "./direct-upload-image.js";
import { normalizeAdImage } from "../lib/image-normalize.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import type { AdSchema } from "../lib/yaml-schema.js";
import { validateLiveAck } from "../lib/api/confirm-gate.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { SCOPES } from "../lib/scopes.js";
import { applyEpkCampaignSettings, hasEpkSettings, type EpkSettings } from "../lib/epk-settings.js";

/** Narrow the first ad in a group to extract Href for site_url fallback. */
function extractFirstHref(ad: z.infer<typeof AdSchema> | undefined): string | undefined {
  if (!ad) return undefined;
  if (ad.Type === "TEXT_AD") return ad.TextAd.Href;
  if (ad.Type === "TEXT_IMAGE_AD") return ad.TextImageAd.Href;
  return undefined;
}

const InputSchema = z.object({
  folder: z.string().min(1).describe("Absolute path to the campaign folder containing _campaign.yaml and group-*.yaml files"),
  dry_run: z.boolean().default(true).describe("If true (default), returns plan preview without creating sitelinks/promo/images. Set to false to run live orchestration."),
  plan_hash: z.string().optional().describe("Plan hash from a prior dry_run — required when dry_run=false to bind the live run"),
  confirm: z.boolean().optional().describe("Must be true when dry_run=false"),
  acknowledge_live: z.string().optional().describe("Acknowledgement string required when dry_run=false"),
  canary_passed: z.boolean().optional().describe("Set to true in Stage 2 after reviewing canary results"),
  continuation_ack: z.string().optional().describe("Continuation ack required for Stage 2"),
  account: z.string().optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().optional().describe("Yandex Direct agency client login for sub-client access (optional)"),
  csv_path: z.string().optional().describe("Absolute path to a Key Collector CSV; if omitted, a synthetic CSV is derived from YAML group keywords"),
  site_url: z.string().optional().describe("Default site URL for ads; if omitted, derived from the first ad's Href in the YAML bundle"),
});

/** Build a minimal Key Collector CSV from YAML group keywords. */
async function buildSyntheticCsv(bundle: ReturnType<typeof loadCampaignFolder>): Promise<string> {
  const { writeFileSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const csvPath = join(tmpdir(), `yaml-bundle-${Date.now()}.csv`);
  const BOM = "﻿";
  const header = "Кластер;Маркерный запрос;Запрос;Тип;Частотность;Частотность «!»;Частотность «[!]»;Показы Директ;Клики Директ;CTR Директ;CTR 1 место;CTR премиум;Клики 1 место;Клики премиум;Мин. ставка;Макс. ставка;Мин. ставка премиум;Макс. ставка премиум;Мин. ставка 1 стр.;Макс. ставка 1 стр.;Мин. цена 1 стр.;Макс. цена 1 стр.;Мин. цена;Макс. цена;Валюта";
  const lines: string[] = [BOM + header];
  for (const g of bundle.groups) {
    const clusterId = g._meta?.cluster_id ?? g.group.Name.split("_")[0] ?? "1";
    const marker = g._meta?.marker_query ?? g.keywords[0]?.Keyword ?? "";
    const intent = g._meta?.intent ?? "informational";
    for (const k of g.keywords) {
      lines.push(`${clusterId};${marker};${k.Keyword};${intent};100;100;100;100;5;5;5;5;1;1;10;10;5;5;10;10;1;1;1;5;RUB`);
    }
  }
  writeFileSync(csvPath, lines.join("\n"), "utf8");
  return csvPath;
}

/** Extract the bidding strategy type from the TextCampaign sub-object with a safe fallback. */
function extractBiddingStrategy(
  tc: { BiddingStrategy?: { Search?: { BiddingStrategyType?: unknown } } } | undefined
): "WB_DAILY_BUDGET" | "HIGHEST_POSITION" | "AVERAGE_CPC" {
  const raw = tc?.BiddingStrategy?.Search?.BiddingStrategyType;
  if (raw === "WB_DAILY_BUDGET" || raw === "AVERAGE_CPC") return raw;
  return "HIGHEST_POSITION";
}

/** Build ad_templates from YAML groups so pickAdTemplate receives real ad texts. */
export function extractAdTemplates(bundle: ReturnType<typeof loadCampaignFolder>): AdTemplate[] {
  return bundle.groups.flatMap((g, gi) => {
    const clusterId = g._meta?.cluster_id ?? g.group.Name.split("_")[0] ?? String(gi);
    return g.ads
      .filter((ad) => ad.Type === "TEXT_AD" || ad.Type === "TEXT_IMAGE_AD")
      .map((ad, ai) => {
        const title =
          ad.Type === "TEXT_AD"
            ? (ad.TextAd?.Title ?? "")
            : (ad.TextImageAd?.Title ?? "");
        const title2 =
          ad.Type === "TEXT_AD"
            ? ad.TextAd?.Title2
            : ad.TextImageAd?.Title2;
        const text =
          ad.Type === "TEXT_AD"
            ? (ad.TextAd?.Text ?? "")
            : (ad.TextImageAd?.Text ?? "");
        const href =
          ad.Type === "TEXT_AD"
            ? ad.TextAd?.Href
            : ad.TextImageAd?.Href;
        return {
          variant_label: `${clusterId}-v${ai}`,
          title,
          title2,
          text,
          href,
          cluster_filter: { cluster_id_pattern: `^${clusterId}$` },
        } satisfies AdTemplate;
      });
  });
}

/**
 * Build autotargeting_per_group from bundle group AutoTargetingCategories.
 * Returns Record<cluster_id, Array<{Category, Value}>> for all groups that have
 * AutoTargetingCategories.Items defined.
 */
function buildAutotargetingPerGroup(
  bundle: ReturnType<typeof loadCampaignFolder>
): Record<string, Array<{ Category: string; Value: string }>> {
  const result: Record<string, Array<{ Category: string; Value: string }>> = {};
  for (const g of bundle.groups) {
    const items = g.group.AutoTargetingCategories?.Items;
    if (!items || items.length === 0) continue;
    const clusterId = g._meta?.cluster_id ?? g.group.Name.split("_")[0] ?? g.group.Name;
    result[clusterId] = items as Array<{ Category: string; Value: string }>;
  }
  return result;
}

/**
 * Resolve the pipeline cluster key for a bundle group — same derivation as
 * buildAutotargetingPerGroup / extractCombinatorialPools use for their maps.
 */
function groupClusterKey(
  g: ReturnType<typeof loadCampaignFolder>["groups"][number]
): string {
  return g._meta?.cluster_id ?? g.group.Name.split("_")[0] ?? g.group.Name;
}

/**
 * Per-group sitelinks CONTENT map (cluster key → SitelinksSet) for groups that
 * declare a sitelinks_set override. Fed into computePlanHash so editing a group's
 * sitelinks invalidates a stale plan_hash. Returns undefined when no group has
 * an override (keeps plan_hash identical to pre-override bundles).
 */
export function extractSitelinksPerGroup(
  bundle: ReturnType<typeof loadCampaignFolder>
): Record<string, { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> }> | undefined {
  const result: Record<string, { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> }> = {};
  for (const g of bundle.groups) {
    if (!g.sitelinks_set) continue;
    result[groupClusterKey(g)] = g.sitelinks_set;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Per-group callout texts (cluster key → string[]) for groups that declare a
 * callouts override. Plan_hash input, same contract as extractSitelinksPerGroup.
 */
export function extractCalloutsPerGroup(
  bundle: ReturnType<typeof loadCampaignFolder>
): Record<string, string[]> | undefined {
  const result: Record<string, string[]> = {};
  for (const g of bundle.groups) {
    if (!g.callouts || g.callouts.length === 0) continue;
    result[groupClusterKey(g)] = g.callouts;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Per-group AdImageHashes (cluster key → hash[]) for the combinatorial ad.
 * Each group's ads[].ResponsiveAd.ImageHashes carries `${img_key}` refs; resolveRefs
 * does NOT touch these, so we resolve them here against the live-uploaded image map
 * (imageHashes: key → AdImageHash). Up to 5 images per group.
 */
export function extractImageHashesPerGroup(
  bundle: ReturnType<typeof loadCampaignFolder>,
  imageHashes: Record<string, string>
): Record<string, string[]> | undefined {
  const result: Record<string, string[]> = {};
  for (const g of bundle.groups) {
    const ad = g.ads?.[0] as { ResponsiveAd?: { ImageHashes?: unknown[] } } | undefined; // guardian: allow — ads is a discriminated union
    const refs = ad?.ResponsiveAd?.ImageHashes;
    if (!Array.isArray(refs) || refs.length === 0) continue;
    const hashes: string[] = [];
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      const m = ref.match(/^\$\{(.+)\}$/);
      const resolved = m ? imageHashes[m[1]] : ref; // ${key} → hash, or a literal hash
      if (resolved && !hashes.includes(resolved)) hashes.push(resolved);
      if (hashes.length >= 5) break;
    }
    if (hashes.length > 0) result[groupClusterKey(g)] = hashes;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Summarize per-group sitelinks/callouts overrides for the dry-run plan:
 * which groups override, and how many UNIQUE sets live mode will create
 * (campaign-level set + deduplicated group contents, dedupe by JSON content).
 */
export function summarizePerGroupExtensions(
  bundle: ReturnType<typeof loadCampaignFolder>
): {
  groups_with_sitelinks_override: string[];
  groups_with_callouts_override: string[];
  unique_sitelinks_sets: number;
  unique_callout_sets: number;
} {
  const slContents = new Set<string>();
  const coContents = new Set<string>();
  if (bundle.campaign.sitelinks_set) slContents.add(JSON.stringify(bundle.campaign.sitelinks_set));
  if (bundle.campaign.callouts && bundle.campaign.callouts.length > 0) {
    coContents.add(JSON.stringify(bundle.campaign.callouts));
  }
  const groupsWithSitelinks: string[] = [];
  const groupsWithCallouts: string[] = [];
  for (const g of bundle.groups) {
    if (g.sitelinks_set) {
      groupsWithSitelinks.push(g.group.Name);
      slContents.add(JSON.stringify(g.sitelinks_set));
    }
    if (g.callouts && g.callouts.length > 0) {
      groupsWithCallouts.push(g.group.Name);
      coContents.add(JSON.stringify(g.callouts));
    }
  }
  return {
    groups_with_sitelinks_override: groupsWithSitelinks,
    groups_with_callouts_override: groupsWithCallouts,
    unique_sitelinks_sets: slContents.size,
    unique_callout_sets: coContents.size,
  };
}

/** Yandex Direct returns HTTP 200 with a top-level {error} body for request-level failures
 *  (auth, units, malformed request). Surface it so callers don't report a generic "no Id returned". */
function topLevelApiError(data: Record<string, unknown> | undefined): string | undefined {
  const err = data?.["error"] as Record<string, unknown> | undefined;
  if (!err) return undefined;
  const detail = err["error_detail"];
  return `Direct API error ${String(err["error_code"])}: ${String(err["error_string"])}${detail ? ` — ${String(detail)}` : ""}`;
}

/** Create one sitelinks set via Sitelinks.add; returns the new Id or an error string. */
async function createSitelinksSetLive(
  sitelinks_set: { Sitelinks: Array<{ Title: string; Description?: string; Href: string }> },
  account: string | undefined,
  client_login: string | undefined
): Promise<{ id?: number; error?: string }> {
  const sitelinksResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/sitelinks",
    body: buildSitelinksSetPayload(sitelinks_set),
    account,
    client_login,
  });
  if (!sitelinksResult.ok) {
    return { error: "sitelinks creation failed: HTTP error" };
  }
  // Direct API returns nested result; shape is opaque at this layer
  const data = sitelinksResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
  const apiErr = topLevelApiError(data);
  if (apiErr) {
    return { error: `sitelinks creation failed: ${apiErr}` };
  }
  const result = data?.["result"] as Record<string, unknown> | undefined;
  const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
  const firstItem = addResults?.[0];
  const errors = firstItem?.["Errors"] as Array<Record<string, unknown>> | undefined;
  if (errors && errors.length > 0) {
    const msg = errors.map((e) => e?.["Message"] ?? JSON.stringify(e)).join("; ");
    return { error: `sitelinks creation failed: ${msg}` };
  }
  const id = firstItem?.["Id"];
  if (typeof id !== "number") {
    return { error: "sitelinks creation: no Id returned" };
  }
  return { id };
}

/** Create CALLOUT ad extensions via AdExtensions.add; returns created Ids + item errors. */
async function createCalloutsLive(
  callout_texts: string[],
  account: string | undefined,
  client_login: string | undefined
): Promise<{ ids: number[]; errors: string[] }> {
  const ids: number[] = [];
  const errors: string[] = [];
  const calloutResult = await executeApiCall({
    apiName: "direct",
    endpoint: "/json/v5/adextensions",
    body: buildCalloutPayload({ callout_texts }),
    account,
    client_login,
  });
  if (!calloutResult.ok) {
    return { ids, errors: ["callouts creation failed: HTTP error"] };
  }
  const data = calloutResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
  const calloutApiErr = topLevelApiError(data);
  if (calloutApiErr) {
    return { ids, errors: [`callouts creation failed: ${calloutApiErr}`] };
  }
  const result = data?.["result"] as Record<string, unknown> | undefined;
  const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
  if (addResults) {
    for (const item of addResults) {
      const itemErrors = item?.["Errors"] as Array<Record<string, unknown>> | undefined;
      if (itemErrors && itemErrors.length > 0) {
        const msg = itemErrors.map((e) => e?.["Message"] ?? JSON.stringify(e)).join("; ");
        errors.push(`callout creation failed: ${msg}`);
      } else {
        const id = item?.["Id"];
        if (typeof id === "number") {
          ids.push(id);
        } else {
          errors.push("callout creation: item returned no Id");
        }
      }
    }
  }
  return { ids, errors };
}

/**
 * Extract combinatorial headline/text pools per cluster.
 * If the group has an explicit `combinatorial` field, use that (already capped by schema).
 * Otherwise derive: headlines = unique([Title, Title2]) capped to 7; texts = unique([Text]) capped to 3.
 */
export function extractCombinatorialPools(
  bundle: ReturnType<typeof loadCampaignFolder>
): Record<string, { headlines: string[]; texts: string[] }> {
  const result: Record<string, { headlines: string[]; texts: string[] }> = {};
  for (const g of bundle.groups) {
    const clusterId = g._meta?.cluster_id ?? g.group.Name.split("_")[0] ?? g.group.Name;
    if (g.combinatorial) {
      result[clusterId] = {
        headlines: g.combinatorial.headlines.slice(0, 7),
        texts: g.combinatorial.texts.slice(0, 3),
      };
    } else {
      const headlineSet = new Set<string>();
      const textSet = new Set<string>();
      for (const ad of g.ads) {
        if (ad.Type === "TEXT_AD") {
          if (ad.TextAd?.Title) headlineSet.add(ad.TextAd.Title);
          if (ad.TextAd?.Title2) headlineSet.add(ad.TextAd.Title2);
          if (ad.TextAd?.Text) textSet.add(ad.TextAd.Text);
        } else if (ad.Type === "TEXT_IMAGE_AD") {
          if (ad.TextImageAd?.Title) headlineSet.add(ad.TextImageAd.Title);
          if (ad.TextImageAd?.Title2) headlineSet.add(ad.TextImageAd.Title2);
          if (ad.TextImageAd?.Text) textSet.add(ad.TextImageAd.Text);
        }
      }
      result[clusterId] = {
        headlines: Array.from(headlineSet).slice(0, 7),
        texts: Array.from(textSet).slice(0, 3),
      };
    }
  }
  return result;
}

/**
 * Resolve campaign_type from the bundle's TextCampaign BiddingStrategy.
 * Returns "rsya" when Network is active (non-SERVING_OFF) and Search is SERVING_OFF.
 * Returns "search" otherwise.
 */
export function resolveCampaignType(bundle: ReturnType<typeof loadCampaignFolder>): "search" | "rsya" {
  const bs = bundle.campaign.campaign.TextCampaign?.BiddingStrategy;
  const networkType = bs?.Network?.BiddingStrategyType;
  const searchType = bs?.Search?.BiddingStrategyType;
  if (searchType === "SERVING_OFF" && networkType !== undefined && networkType !== "SERVING_OFF") {
    return "rsya";
  }
  return "search";
}

/** Resolve campaign_strategy from bundle upload_strategy field. */
export function resolveCampaignStrategy(bundle: ReturnType<typeof loadCampaignFolder>): CampaignStrategy {
  const uploadStrategy = bundle.campaign.upload_strategy ?? "one-per-cluster";
  if (uploadStrategy === "single-campaign") {
    return { mode: "single-campaign", campaign_name: bundle.campaign.campaign.Name };
  }
  return { mode: "one-per-cluster" };
}

/**
 * Build the shared uploadCampaignBundle input for a dry-run preview from a
 * bundle-or-resolved source object (both share the same shape). Every field is
 * computed EXACTLY as the inline call sites did, so the resulting plan_hash is
 * unchanged. The live call spreads this and overrides dry_run + adds live-only
 * fields (plan_hash, confirm, image_hashes, per-group id maps, ...).
 *
 * `csvPath`, `siteUrl` and `declaredImageKeys` are computed once at the top of
 * runDirectUploadFromYaml and passed in so they stay identical across every site
 * (csvPath especially — a synthetic CSV must not be regenerated per call).
 */
function buildBundleUploadInput(
  src: ReturnType<typeof loadCampaignFolder>,
  parsed: z.infer<typeof InputSchema>,
  clientLogin: string | undefined,
  csvPath: string,
  siteUrl: string,
  declaredImageKeys: string[],
) {
  const camp = src.campaign.campaign;
  const tc = camp.TextCampaign;
  return {
    csv_path: csvPath,
    campaign_strategy: resolveCampaignStrategy(src),
    campaign_type: resolveCampaignType(src),
    site_url: siteUrl,
    daily_budget_amount: camp.DailyBudget.Amount,
    region_ids: src.groups[0]?.group.RegionIds ?? [213],
    bidding_strategy_type: extractBiddingStrategy(tc),
    metrika_counter_ids: tc?.CounterIds?.Items,
    metrika_goal_ids: tc?.PriorityGoals?.Items?.map((g) => g.GoalId),
    ads_per_group: src.groups[0]?.ads.length ?? 1,
    ad_template_strategy: "agent-provided",
    ad_templates: extractAdTemplates(src),
    dry_run: true,
    canary_percent: 50,
    max_clusters: src.groups.length,
    abort_on_error_rate: 0.3,
    account: parsed.account,
    client_login: clientLogin,
    dedupe_by_name: src.campaign.dedupe_by_name ?? true,
    tracking_params: tc?.TrackingParams,
    sitelinks_set: src.campaign.sitelinks_set,
    callouts: src.campaign.callouts,
    promo_extension: src.campaign.promo_extension,
    bidding_strategy: tc?.BiddingStrategy as Record<string, unknown> | undefined,
    declared_image_keys: declaredImageKeys.length > 0 ? declaredImageKeys : null,
    autotargeting_per_group: buildAutotargetingPerGroup(src),
    combinatorial_per_group: extractCombinatorialPools(src),
    sitelinks_set_per_group: extractSitelinksPerGroup(src),
    callouts_per_group: extractCalloutsPerGroup(src),
  };
}

export async function runDirectUploadFromYaml(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);

    // 1. Load and validate YAML bundle
    const bundle = loadCampaignFolder(parsed.folder);
    const clientLogin = parsed.client_login ?? bundle.campaign.client_login;
    if (bundle.validation_errors.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: "YAML validation failed",
            validation_errors: bundle.validation_errors,
          }, null, 2),
        }],
      };
    }

    const camp = bundle.campaign.campaign;

    // Image keys declared in the bundle — stable at both dry-run and live time.
    // Used as the plan_hash image input so dry and live hashes always agree.
    const declaredImageKeys = Object.keys(bundle.campaign.images ?? {}).sort();

    // Derive site_url from first ad Href in YAML if not provided
    const siteUrl: string =
      parsed.site_url
      ?? extractFirstHref(bundle.groups[0]?.ads[0])
      ?? "https://example.com";

    // Build or use provided CSV path (required by uploadCampaignBundle). The SAME
    // csvPath value is reused across every buildBundleUploadInput call site — a
    // synthetic CSV must never be regenerated per call (would change csv_hash).
    const csvPath = parsed.csv_path ?? await buildSyntheticCsv(bundle);

    // Per-call region_ids / bidding_strategy_type / metrika ids / ads_per_group are
    // derived inside buildBundleUploadInput from the passed source (bundle | resolved).

    // 2. Dry run — compute plan without creating any dependencies
    if (parsed.dry_run) {
      // uploadCampaignBundle accepts additional Phase 3.5.D fields via its loose input type
      const result = await uploadCampaignBundle(
        buildBundleUploadInput(bundle, parsed, clientLogin, csvPath, siteUrl, declaredImageKeys) as Parameters<typeof uploadCampaignBundle>[0], // guardian: allow — Phase 3.5.D optional fields not in base type
      );

      const perGroupSummary = summarizePerGroupExtensions(bundle);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            stage: "dry_run",
            yaml_validation: "OK",
            bundle_summary: {
              campaign_name: camp.Name,
              campaign_type: camp.Type,
              groups: bundle.groups.length,
              total_ads: bundle.groups.reduce((s, g) => s + g.ads.length, 0),
              total_keywords: bundle.groups.reduce((s, g) => s + g.keywords.length, 0),
              has_sitelinks: !!bundle.campaign.sitelinks_set
                || perGroupSummary.groups_with_sitelinks_override.length > 0,
              has_promo: !!bundle.campaign.promo_extension,
              has_images: !!bundle.campaign.images && Object.keys(bundle.campaign.images).length > 0,
              has_epk_settings: hasEpkSettings(bundle.campaign.epk_settings as EpkSettings | undefined),
              groups_with_sitelinks_override: perGroupSummary.groups_with_sitelinks_override,
              groups_with_callouts_override: perGroupSummary.groups_with_callouts_override,
              unique_sitelinks_sets_to_create: perGroupSummary.unique_sitelinks_sets,
              unique_callout_sets_to_create: perGroupSummary.unique_callout_sets,
            },
            pipeline_result: result,
          }, null, 2),
        }],
      };
    }

    // 3. Live mode — gate check first, then create dependencies, then run pipeline
    //
    // SECURITY INVARIANT: dependency creation (sitelinks/promo/callouts/images) MUST NOT
    // happen unless the caller has explicitly confirmed with confirm=true AND provided a
    // plan_hash. Without these, we return the dry-run plan so they can obtain plan_hash
    // and construct the correct acknowledge_live string — no mutations occur.
    if (parsed.confirm !== true || !parsed.plan_hash) {
      // Return the plan preview (same as dry_run=true) without creating any dependencies.
      const planResult = await uploadCampaignBundle(
        buildBundleUploadInput(bundle, parsed, clientLogin, csvPath, siteUrl, declaredImageKeys) as Parameters<typeof uploadCampaignBundle>[0], // guardian: allow — Phase 3.5.D optional fields not in base type
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            stage: "plan_needed",
            reason: !parsed.confirm
              ? "confirm: true is required to run live"
              : "plan_hash is required to run live — obtain it from this plan result",
            yaml_validation: "OK",
            pipeline_result: planResult,
          }, null, 2),
        }],
      };
    }

    // confirm=true and plan_hash are present. Now validate acknowledge_live
    // BEFORE creating any dependencies — a bad/missing ack must be rejected here
    // so no orphaned sitelinks/callouts/images are created on the live account.
    // Resolve the account to get the exact yandex_login for the ack check.
    const liveAcc = resolveAccount(SCOPES.DIRECT_API, parsed.account);
    // Ack names the TARGET cabinet: sub-client login when uploading via agency Client-Login,
    // the account's own login otherwise. Keep in sync with expectedAckLive in upload-pipeline.ts.
    const liveLogin = parsed.client_login ?? (liveAcc.yandex_login ?? liveAcc.label);
    if (!validateLiveAck(parsed.acknowledge_live, liveLogin, parsed.plan_hash)) {
      const planResult2 = await uploadCampaignBundle(
        buildBundleUploadInput(bundle, parsed, clientLogin, csvPath, siteUrl, declaredImageKeys) as Parameters<typeof uploadCampaignBundle>[0], // guardian: allow — Phase 3.5.D optional fields not in base type
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            stage: "plan_needed",
            reason: "acknowledge_live is missing or invalid — must be exactly I-UNDERSTAND-BUNDLE-LIVE:<login>:<plan_hash_prefix12>. Obtain the expected value from the dry_run pipeline_result.expected_ack_live.",
            yaml_validation: "OK",
            pipeline_result: planResult2,
          }, null, 2),
        }],
      };
    }

    // Recompute the canonical plan_hash NOW (before any dep creation) by running an
    // authoritative dry-run.  This closes the window where a caller passes a WRONG
    // plan_hash that happens to produce a matching ack prefix: validateLiveAck above
    // only checks the first 12 chars, so a wrong-but-prefix-matching hash would slip
    // through without this extra gate.
    {
      const canonicalResult = await uploadCampaignBundle(
        buildBundleUploadInput(bundle, parsed, clientLogin, csvPath, siteUrl, declaredImageKeys) as Parameters<typeof uploadCampaignBundle>[0], // guardian: allow — Phase 3.5.D optional fields not in base type
      );

      const canonicalPlanHash = canonicalResult.plan_hash;
      if (parsed.plan_hash !== canonicalPlanHash) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              stage: "plan_needed",
              reason: "The supplied plan_hash is stale or invalid — it does not match the canonical plan_hash computed from the current bundle state. Please obtain a fresh dry_run result and use its plan_hash and expected_ack_live.",
              yaml_validation: "OK",
              pipeline_result: canonicalResult,
            }, null, 2),
          }],
        };
      }
    }

    // acknowledge_live validated and plan_hash confirmed canonical — safe to create dependencies.

    const context: {
      sitelinks_set_id?: number;
      promo_extension_id?: number;
      callout_ids: number[];
      sitelinks_set_id_per_group: Record<string, number>;
      callout_ids_per_group: Record<string, number[]>;
      image_hashes: Record<string, string>;
      dep_errors: string[];
    } = {
      callout_ids: [],
      sitelinks_set_id_per_group: {},
      callout_ids_per_group: {},
      image_hashes: {},
      dep_errors: [],
    };

    // 3a. Sitelinks sets — campaign-level first, then per-group overrides.
    //     Each UNIQUE sitelinks content (dedupe by JSON.stringify) is created exactly once;
    //     groups sharing content (incl. content identical to campaign-level) reuse the Id.
    const sitelinksIdByContent = new Map<string, number>();
    if (bundle.campaign.sitelinks_set) {
      const created = await createSitelinksSetLive(bundle.campaign.sitelinks_set, parsed.account, clientLogin);
      if (created.id === undefined) {
        context.dep_errors.push(created.error ?? "sitelinks creation: no Id returned");
      } else {
        context.sitelinks_set_id = created.id;
        sitelinksIdByContent.set(JSON.stringify(bundle.campaign.sitelinks_set), created.id);
      }
    }
    for (const g of bundle.groups) {
      if (!g.sitelinks_set) continue;
      const contentKey = JSON.stringify(g.sitelinks_set);
      let sitelinksId = sitelinksIdByContent.get(contentKey);
      if (sitelinksId === undefined) {
        const created = await createSitelinksSetLive(g.sitelinks_set, parsed.account, clientLogin);
        if (created.id === undefined) {
          context.dep_errors.push(
            `group "${g.group.Name}": ${created.error ?? "sitelinks creation: no Id returned"}`
          );
          continue;
        }
        sitelinksId = created.id;
        sitelinksIdByContent.set(contentKey, sitelinksId);
      }
      context.sitelinks_set_id_per_group[groupClusterKey(g)] = sitelinksId;
    }

    // 3b. Promo extension
    if (bundle.campaign.promo_extension) {
      const promoResult = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/adextensions",
        body: buildPromoExtensionPayload(bundle.campaign.promo_extension.AdExtension),
        account: parsed.account,
        client_login: clientLogin,
      });
      if (!promoResult.ok) {
        context.dep_errors.push(`promo extension creation failed: HTTP error`);
      } else {
        const data = promoResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
        const promoApiErr = topLevelApiError(data);
        if (promoApiErr) {
          context.dep_errors.push(`promo extension creation failed: ${promoApiErr}`);
        } else {
          const result = data?.["result"] as Record<string, unknown> | undefined;
          const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
          const firstItem = addResults?.[0];
          const errors = firstItem?.["Errors"] as Array<Record<string, unknown>> | undefined;
          if (errors && errors.length > 0) {
            const msg = errors.map((e) => e?.["Message"] ?? JSON.stringify(e)).join("; ");
            context.dep_errors.push(`promo extension creation failed: ${msg}`);
          } else {
            const id = firstItem?.["Id"];
            context.promo_extension_id = typeof id === "number" ? id : undefined;
            if (context.promo_extension_id === undefined) {
              context.dep_errors.push("promo extension creation: no Id returned");
            }
          }
        }
      }
    }

    // 3c. Callouts (Уточнения) — per naming map §5.2: POST /json/v5/adextensions with type CALLOUT.
    //     IDs are wired at ad level via TextAd.AdExtensions.Items / TextImageAd.AdExtensions.Items.
    //     Campaign-level first, then per-group overrides (unique text sets created once).
    const calloutIdsByContent = new Map<string, number[]>();
    if (bundle.campaign.callouts && bundle.campaign.callouts.length > 0) {
      const created = await createCalloutsLive(bundle.campaign.callouts, parsed.account, clientLogin);
      context.dep_errors.push(...created.errors);
      context.callout_ids.push(...created.ids);
      if (created.errors.length === 0) {
        calloutIdsByContent.set(JSON.stringify(bundle.campaign.callouts), created.ids);
      }
    }
    for (const g of bundle.groups) {
      if (!g.callouts || g.callouts.length === 0) continue;
      const contentKey = JSON.stringify(g.callouts);
      let groupCalloutIds = calloutIdsByContent.get(contentKey);
      if (groupCalloutIds === undefined) {
        const created = await createCalloutsLive(g.callouts, parsed.account, clientLogin);
        if (created.errors.length > 0) {
          context.dep_errors.push(...created.errors.map((e) => `group "${g.group.Name}": ${e}`));
          continue;
        }
        groupCalloutIds = created.ids;
        calloutIdsByContent.set(contentKey, groupCalloutIds);
      }
      context.callout_ids_per_group[groupClusterKey(g)] = groupCalloutIds;
    }

    // 3d. Images
    const skippedImages: string[] = [];
    if (bundle.campaign.images) {
      for (const [name, imgDef] of Object.entries(bundle.campaign.images)) {
        // imgDef shape: { source, url?, path?, base64? } — map to runDirectUploadImage input
        let uploadInput: { url?: string; file_path?: string; base64?: string; account?: string; client_login?: string };

        if (imgDef.path) {
          // Normalize local file images (aspect ratio fix for Yandex 16:9 requirement)
          let norm: Awaited<ReturnType<typeof normalizeAdImage>>;
          try {
            norm = await normalizeAdImage(imgDef.path);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[image-normalize] skipping "${name}": normalize threw — ${msg}`); // guardian: allow
            skippedImages.push(`${name}: normalize threw — ${msg}`);
            continue;
          }
          if (norm.action === "skip") {
            console.warn(`[image-normalize] skipping "${name}": ${norm.reason}`);
            skippedImages.push(`${name}: ${norm.reason}`);
            continue;
          } else if (norm.action === "resized") {
            uploadInput = { base64: norm.base64, account: parsed.account, client_login: clientLogin };
          } else {
            // asis
            uploadInput = { file_path: imgDef.path, account: parsed.account, client_login: clientLogin };
          }
        } else {
          uploadInput = {
            url: imgDef.url,
            file_path: imgDef.path,
            base64: imgDef.base64,
            account: parsed.account,
            client_login: clientLogin,
          };
        }

        const uploadResult = await runDirectUploadImage(uploadInput);
        const firstContent = uploadResult.content?.[0];
        if (firstContent && "text" in firstContent) {
          const parsed_img = JSON.parse(firstContent.text) as Record<string, unknown>;
          const hash = parsed_img?.["ad_image_hash"];
          if (typeof hash === "string") {
            context.image_hashes[name] = hash;
          } else {
            let detail = "";
            if (typeof parsed_img?.["error"] === "string") {
              detail = parsed_img["error"];
              if (parsed_img?.["details"]) {
                detail += ` — details: ${JSON.stringify(parsed_img["details"])}`;
              }
              if (parsed_img?.["errors"]) {
                detail += ` — errors: ${JSON.stringify(parsed_img["errors"])}`;
              }
            } else if (parsed_img?.["errors"]) {
              detail = `errors: ${JSON.stringify(parsed_img["errors"])}`;
            } else if (parsed_img?.["details"]) {
              detail = `details: ${JSON.stringify(parsed_img["details"])}`;
            } else {
              detail = firstContent.text.slice(0, 300);
            }
            context.dep_errors.push(`image upload failed for "${name}": no ad_image_hash in response — ${detail}`);
          }
        } else {
          context.dep_errors.push(`image upload failed for "${name}": unexpected response shape`);
        }
      }
    }

    // 3e. Abort on dep errors before campaign creation.
    // The bundle declared these dependencies intentionally; creating a partial campaign
    // (e.g. RSYA text-only if an image failed, or missing sitelinks) is worse than
    // aborting cleanly and letting the caller fix the issue.
    if (context.dep_errors.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            stage: "dep_creation_failed",
            reason: "One or more required dependencies failed to create. Campaign creation aborted to prevent a partial/incomplete campaign on the live account.",
            dep_errors: context.dep_errors,
          }, null, 2),
        }],
      };
    }

    // 4. Resolve template refs in bundle with created IDs/hashes
    const resolved = resolveRefs(bundle, {
      sitelinks_set_id: context.sitelinks_set_id,
      promo_extension_id: context.promo_extension_id,
      image_hashes: context.image_hashes,
    });

    // 5. Run upload pipeline with live params.
    // Shared inputs come from buildBundleUploadInput(resolved, ...) — the SAME
    // derivation the dry-run/plan-hash sites use, so the live plan_hash matches the
    // approved dry-run. We then override dry_run and add the live-only fields
    // (confirm gate + pre-created IDs/hashes). buildBundleUploadInput already sets
    // bidding_strategy / sitelinks_set / callouts CONTENT etc. from the resolved
    // bundle, exactly as the old inline object did.
    const pipelineResult = await uploadCampaignBundle({
      ...buildBundleUploadInput(resolved, parsed, clientLogin, csvPath, siteUrl, declaredImageKeys),
      dry_run: false,
      plan_hash: parsed.plan_hash,
      confirm: parsed.confirm,
      acknowledge_live: parsed.acknowledge_live,
      canary_passed: parsed.canary_passed,
      continuation_ack: parsed.continuation_ack,
      // F6 wiring — pass pre-created IDs/hashes to the pipeline
      image_hashes: context.image_hashes,
      // Per-group images: resolve each group's ${img_key} refs → uploaded AdImageHashes.
      image_hashes_per_group: extractImageHashesPerGroup(bundle, context.image_hashes),
      sitelinks_set_id: context.sitelinks_set_id,
      callout_ids: context.callout_ids.length > 0 ? context.callout_ids : undefined,
      // Per-group overrides — groups present in the maps use these ids; others
      // fall back to the campaign-level sitelinks_set_id / callout_ids above.
      sitelinks_set_id_per_group: Object.keys(context.sitelinks_set_id_per_group).length > 0
        ? context.sitelinks_set_id_per_group
        : undefined,
      callout_ids_per_group: Object.keys(context.callout_ids_per_group).length > 0
        ? context.callout_ids_per_group
        : undefined,
    } as Parameters<typeof uploadCampaignBundle>[0]); // guardian: allow — Phase 3.5.D optional fields not in base type

    // 6. Apply optional ЕПК campaign settings (epk_settings) POST-CREATE to every
    //    campaign the pipeline created — excluded_sites / attribution / schedule /
    //    notification / settings / campaign negative keywords + bid_modifiers
    //    (корректировки). Additive & non-fatal: failures are reported, not thrown.
    const epkSettings = resolved.campaign.epk_settings as EpkSettings | undefined;
    let epkSettingsApplied: Awaited<ReturnType<typeof applyEpkCampaignSettings>>[] | undefined;
    const createdCampaignIds = (pipelineResult as { campaigns_created?: number[] })?.campaigns_created ?? [];
    if (hasEpkSettings(epkSettings) && createdCampaignIds.length > 0) {
      epkSettingsApplied = [];
      for (const cid of createdCampaignIds) {
        epkSettingsApplied.push(
          await applyEpkCampaignSettings({ campaign_id: cid, settings: epkSettings!, account: parsed.account, client_login: clientLogin }),
        );
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          stage: "live_orchestration",
          context_created: {
            sitelinks_set_id: context.sitelinks_set_id,
            promo_extension_id: context.promo_extension_id,
            callout_ids: context.callout_ids,
            sitelinks_set_id_per_group: context.sitelinks_set_id_per_group,
            callout_ids_per_group: context.callout_ids_per_group,
            images_uploaded: Object.keys(context.image_hashes),
          },
          dep_errors: context.dep_errors.length > 0 ? context.dep_errors : undefined,
          pipeline_result: pipelineResult,
          epk_settings_applied: epkSettingsApplied,
        }, null, 2),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

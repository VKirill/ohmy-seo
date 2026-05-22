import { z } from "zod";
import { loadCampaignFolder, resolveRefs } from "../lib/yaml-loader.js";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildSitelinksSetPayload, buildPromoExtensionPayload, buildCalloutPayload } from "../lib/payload-builder.js";
import { uploadCampaignBundle, type AdTemplate, type CampaignStrategy } from "../lib/upload-pipeline.js";
import { runDirectUploadImage } from "./direct-upload-image.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import type { AdSchema } from "../lib/yaml-schema.js";

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
    const marker = g.keywords[0]?.Keyword ?? "";
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

export async function runDirectUploadFromYaml(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);

    // 1. Load and validate YAML bundle
    const bundle = loadCampaignFolder(parsed.folder);
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
    const tc = camp.TextCampaign;

    // Derive site_url from first ad Href in YAML if not provided
    const siteUrl: string =
      parsed.site_url
      ?? extractFirstHref(bundle.groups[0]?.ads[0])
      ?? "https://example.com";

    // Build or use provided CSV path (required by uploadCampaignBundle)
    const csvPath = parsed.csv_path ?? await buildSyntheticCsv(bundle);

    const regionIds = bundle.groups[0]?.group.RegionIds ?? [213];
    const biddingStrategyType = extractBiddingStrategy(tc);
    const counterIds = tc?.CounterIds?.Items;
    const goalIds = tc?.PriorityGoals?.Items?.map((g) => g.GoalId);
    const adsPerGroup = bundle.groups[0]?.ads.length ?? 1;

    // 2. Dry run — compute plan without creating any dependencies
    if (parsed.dry_run) {
      const ad_templates = extractAdTemplates(bundle);
      const campaignStrategy = resolveCampaignStrategy(bundle);
      const campaignType = resolveCampaignType(bundle);
      // uploadCampaignBundle accepts additional Phase 3.5.D fields via its loose input type
      const result = await uploadCampaignBundle({
        csv_path: csvPath,
        campaign_strategy: campaignStrategy,
        campaign_type: campaignType,
        site_url: siteUrl,
        daily_budget_amount: camp.DailyBudget.Amount,
        region_ids: regionIds,
        bidding_strategy_type: biddingStrategyType,
        metrika_counter_ids: counterIds,
        metrika_goal_ids: goalIds,
        ads_per_group: adsPerGroup,
        ad_template_strategy: "agent-provided",
        ad_templates,
        dry_run: true,
        canary_percent: 50,
        max_clusters: bundle.groups.length,
        abort_on_error_rate: 0.3,
        account: parsed.account,
        dedupe_by_name: bundle.campaign.dedupe_by_name,
        tracking_params: tc?.TrackingParams,
        sitelinks_set: bundle.campaign.sitelinks_set,
        promo_extension: bundle.campaign.promo_extension,
      } as Parameters<typeof uploadCampaignBundle>[0]); // guardian: allow — Phase 3.5.D optional fields not in base type

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
              has_sitelinks: !!bundle.campaign.sitelinks_set,
              has_promo: !!bundle.campaign.promo_extension,
              has_images: !!bundle.campaign.images && Object.keys(bundle.campaign.images).length > 0,
            },
            pipeline_result: result,
          }, null, 2),
        }],
      };
    }

    // 3. Live mode — create dependencies first, then run pipeline

    const context: {
      sitelinks_set_id?: number;
      promo_extension_id?: number;
      callout_ids: number[];
      image_hashes: Record<string, string>;
    } = { callout_ids: [], image_hashes: {} };

    // 3a. Sitelinks set
    if (bundle.campaign.sitelinks_set) {
      const sitelinksResult = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/sitelinks",
        body: buildSitelinksSetPayload(bundle.campaign.sitelinks_set),
        account: parsed.account,
      });
      if (sitelinksResult.ok) {
        // Direct API returns nested result; shape is opaque at this layer
        const data = sitelinksResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
        const result = data?.["result"] as Record<string, unknown> | undefined;
        const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
        const id = addResults?.[0]?.["Id"];
        context.sitelinks_set_id = typeof id === "number" ? id : undefined;
      }
    }

    // 3b. Promo extension
    if (bundle.campaign.promo_extension) {
      const promoResult = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/adextensions",
        body: buildPromoExtensionPayload(bundle.campaign.promo_extension.AdExtension),
        account: parsed.account,
      });
      if (promoResult.ok) {
        const data = promoResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
        const result = data?.["result"] as Record<string, unknown> | undefined;
        const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
        const id = addResults?.[0]?.["Id"];
        context.promo_extension_id = typeof id === "number" ? id : undefined;
      }
    }

    // 3c. Callouts (Уточнения) — per naming map §5.2: POST /json/v5/adextensions with type CALLOUT
    //     IDs are wired at ad level via TextAd.AdExtensions.Items / TextImageAd.AdExtensions.Items
    if (bundle.campaign.callouts && bundle.campaign.callouts.length > 0) {
      const calloutResult = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/adextensions",
        body: buildCalloutPayload({ callout_texts: bundle.campaign.callouts }),
        account: parsed.account,
      });
      if (calloutResult.ok) {
        const data = calloutResult.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
        const result = data?.["result"] as Record<string, unknown> | undefined;
        const addResults = result?.["AddResults"] as Array<Record<string, unknown>> | undefined;
        if (addResults) {
          for (const item of addResults) {
            const id = item?.["Id"];
            if (typeof id === "number") {
              context.callout_ids.push(id);
            }
          }
        }
      }
    }

    // 3d. Images
    if (bundle.campaign.images) {
      for (const [name, imgDef] of Object.entries(bundle.campaign.images)) {
        // imgDef shape: { source, url?, path?, base64? } — map to runDirectUploadImage input
        const uploadInput = {
          url: imgDef.url,
          file_path: imgDef.path,
          base64: imgDef.base64,
          account: parsed.account,
        };
        const uploadResult = await runDirectUploadImage(uploadInput);
        const firstContent = uploadResult.content?.[0];
        if (firstContent && "text" in firstContent) {
          const parsed_img = JSON.parse(firstContent.text) as Record<string, unknown>;
          const hash = parsed_img?.["ad_image_hash"];
          if (typeof hash === "string") {
            context.image_hashes[name] = hash;
          }
        }
      }
    }

    // 4. Resolve template refs in bundle with created IDs/hashes
    const resolved = resolveRefs(bundle, {
      sitelinks_set_id: context.sitelinks_set_id,
      promo_extension_id: context.promo_extension_id,
      image_hashes: context.image_hashes,
    });

    // 5. Run upload pipeline with live params
    const resolvedCamp = resolved.campaign.campaign;
    const resolvedTc = resolvedCamp.TextCampaign;
    const resolvedBiddingStrategy = extractBiddingStrategy(resolvedTc);
    const resolvedGoalIds = resolvedTc?.PriorityGoals?.Items?.map((g) => g.GoalId);
    const ad_templates = extractAdTemplates(resolved);
    const campaignStrategy = resolveCampaignStrategy(resolved);

    const resolvedCampaignType = resolveCampaignType(resolved);
    const pipelineResult = await uploadCampaignBundle({
      csv_path: csvPath,
      campaign_strategy: campaignStrategy,
      campaign_type: resolvedCampaignType,
      site_url: siteUrl,
      daily_budget_amount: resolvedCamp.DailyBudget.Amount,
      region_ids: resolved.groups[0]?.group.RegionIds ?? [213],
      bidding_strategy_type: resolvedBiddingStrategy,
      metrika_counter_ids: resolvedTc?.CounterIds?.Items,
      metrika_goal_ids: resolvedGoalIds,
      ads_per_group: resolved.groups[0]?.ads.length ?? 1,
      ad_template_strategy: "agent-provided",
      ad_templates,
      dry_run: false,
      canary_percent: 50,
      max_clusters: resolved.groups.length,
      abort_on_error_rate: 0.3,
      plan_hash: parsed.plan_hash,
      confirm: parsed.confirm,
      acknowledge_live: parsed.acknowledge_live,
      canary_passed: parsed.canary_passed,
      continuation_ack: parsed.continuation_ack,
      account: parsed.account,
      dedupe_by_name: resolved.campaign.dedupe_by_name,
      tracking_params: resolvedTc?.TrackingParams,
      sitelinks_set: resolved.campaign.sitelinks_set,
      promo_extension: resolved.campaign.promo_extension,
      // F6 wiring — pass pre-created IDs/hashes to the pipeline
      image_hashes: context.image_hashes,
      sitelinks_set_id: context.sitelinks_set_id,
      callout_ids: context.callout_ids.length > 0 ? context.callout_ids : undefined,
    } as Parameters<typeof uploadCampaignBundle>[0]); // guardian: allow — Phase 3.5.D optional fields not in base type

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          stage: "live_orchestration",
          context_created: {
            sitelinks_set_id: context.sitelinks_set_id,
            promo_extension_id: context.promo_extension_id,
            callout_ids: context.callout_ids,
            images_uploaded: Object.keys(context.image_hashes),
          },
          pipeline_result: pipelineResult,
        }, null, 2),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

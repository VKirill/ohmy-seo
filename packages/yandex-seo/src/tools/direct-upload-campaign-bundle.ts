import { z } from "zod";
import { uploadCampaignBundle, type UploadCampaignBundleInput } from "../lib/upload-pipeline.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  csv_path: z.string(),

  campaign_strategy: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("one-per-cluster") }),
    z.object({ mode: z.literal("one-per-intent"), intent_to_campaign: z.record(z.string(), z.string()) }),
    z.object({ mode: z.literal("single-campaign"), campaign_name: z.string() }),
  ]),

  campaign_type: z.enum(["search", "rsya", "rsya-only"]),
  site_url: z.string(),
  daily_budget_amount: z.number().int().positive().optional(), // ACCOUNT-currency micros (preferred, currency-agnostic)
  daily_budget_rub: z.number().int().min(100).optional(),       // deprecated RUB fallback (× 1e6 by resolveDailyBudgetMicros)
  region_ids: z.array(z.number().int()).min(1),
  bidding_strategy_type: z.enum(["WB_DAILY_BUDGET", "HIGHEST_POSITION", "AVERAGE_CPC"]),

  metrika_counter_ids: z.array(z.number().int()).optional(),
  metrika_goal_ids: z.array(z.number().int()).optional(),
  rsya_image_urls: z.array(z.string()).optional(),

  ads_per_group: z.number().int().min(1).max(50).default(3),
  ad_template_strategy: z.enum(["agent-provided", "fallback-template"]).default("fallback-template"),
  ad_templates: z.array(z.any()).optional(),

  dry_run: z.boolean().default(true),
  canary_percent: z.number().min(1).max(100).default(10),
  max_clusters: z.number().int().positive().default(50),
  abort_on_error_rate: z.number().min(0).max(1).default(0.3),

  // Live execution fields (only used when dry_run=false)
  plan_hash: z.string().optional(),
  confirm: z.boolean().optional(),
  acknowledge_live: z.string().optional(),

  // Stage 2 continuation fields
  canary_passed: z.boolean().optional(),
  continuation_ack: z.string().optional(),

  account: z.string().optional(),

  // Phase 3.5.D extensions — all optional, backwards-compatible
  sitelinks_set: z.object({
    Sitelinks: z.array(z.object({
      Title: z.string(),
      Description: z.string().optional(),
      Href: z.string(),
    })),
  }).optional(),
  promo_extension: z.object({
    AdExtension: z.object({
      PromoExtension: z.object({
        PromotionType: z.string(),
        Discount: z.number().optional(),
        DiscountUnit: z.string().optional(),
        StartDate: z.string().optional(),
        EndDate: z.string(),
        PromoCode: z.string().optional(),
        Href: z.string().optional(),
      }),
    }),
  }).optional(),
  tracking_params: z.string().optional(),
  autotargeting_per_group: z.record(
    z.string(),
    z.array(z.object({
      Category: z.string(),
      Value: z.enum(["YES", "NO"]),
    }))
  ).optional(),
  ad_format_mix: z.array(z.enum(["TEXT_AD", "TEXT_IMAGE_AD", "RESPONSIVE_AD"])).optional(),
  campaign_types: z.array(z.enum(["TEXT_CAMPAIGN", "UNIFIED_PERFORMANCE_CAMPAIGN"])).optional(),
});

export type DirectUploadCampaignBundleInput = z.infer<typeof InputSchema>;

export async function runDirectUploadCampaignBundle(input: DirectUploadCampaignBundleInput) {
  try {
    const parsed = InputSchema.parse(input);
    const result = await uploadCampaignBundle(parsed as unknown as UploadCampaignBundleInput);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

import { z } from "zod";

// ============= Enums =============
export const CampaignType = z.enum([
  "TEXT_CAMPAIGN",
  "MOBILE_APP_CAMPAIGN",
  "DYNAMIC_TEXT_CAMPAIGN",
  "UNIFIED_PERFORMANCE_CAMPAIGN",
  "SMART_CAMPAIGN",
  "CPM_BANNER_CAMPAIGN",
]);

export const AdGroupType = z.enum([
  "TEXT_AD_GROUP",
  "UNIFIED_AD_GROUP",
  "MOBILE_APP_AD_GROUP",
  "DYNAMIC_TEXT_AD_GROUP",
  "SMART_AD_GROUP",
  "CPM_BANNER_AD_GROUP",
]);

export const AdType = z.enum([
  "TEXT_AD",
  "TEXT_IMAGE_AD",
  "TEXT_AD_BUILDER_AD",
  "RESPONSIVE_AD",
  "DYNAMIC_TEXT_AD",
  "MOBILE_APP_AD",
  "MOBILE_APP_IMAGE_AD",
  "SMART_AD",
  "IMAGE_AD",
  "CPC_VIDEO_AD",
  "CPM_BANNER_AD",
  "CPM_VIDEO_AD",
  "SHOPPING_AD",
  "LISTING_AD",
]);

export const BiddingStrategyType = z.enum([
  "HIGHEST_POSITION",
  "WB_DAILY_BUDGET",
  "AVERAGE_CPC",
  "AVERAGE_CPA",
  "AVERAGE_ROI",
  "PAY_FOR_CONVERSION",
  "MAXIMUM_COVERAGE",
  "WB_MAXIMUM_CLICKS",
  "SERVING_OFF",
]);

export const AutoTargetingCategory = z.enum([
  "TARGET_QUERIES",
  "ALTERNATIVE_QUERIES",
  "COMPETITOR_QUERIES",
  "ACCESSORY_QUERIES",
  "BROAD_MATCH",
  "EXACT_MENTION",
]);

export const YesNoEnum = z.enum(["YES", "NO"]);

// ============= Helper: ref string =============
const RefString = z.string().regex(/^\$\{[a-zA-Z_][a-zA-Z0-9_.-]*\}$/);
const NumberOrRef = z.union([z.number(), RefString]);
const StringOrRef = z.union([z.string(), RefString]);

// ============= Ad sub-schemas =============
const TextAdSchema = z.object({
  Title: z.string().min(1),
  Title2: z.string().optional(),
  Text: z.string().min(1),
  Href: z.string(),
  Mobile: YesNoEnum.optional(),
  DisplayUrlPath: z.string().optional(),
  AdImageHash: StringOrRef.optional(),
  SitelinksSetId: NumberOrRef.optional(),
  AdExtensions: z.object({ Items: z.array(NumberOrRef) }).optional(),
  VCardId: NumberOrRef.optional(),
  TurboPageId: NumberOrRef.optional(),
});

const TextImageAdSchema = z.object({
  AdImageHash: StringOrRef,
  Title: z.string(),
  Title2: z.string().optional(),
  Text: z.string(),
  Href: z.string(),
  SitelinksSetId: NumberOrRef.optional(),
  AdExtensions: z.object({ Items: z.array(NumberOrRef) }).optional(),
});

const ResponsiveAdSchema = z.object({
  Titles: z.array(z.string()).min(1).max(5),
  Title2s: z.array(z.string()).max(5).optional(),
  Texts: z.array(z.string()).min(1).max(3),
  Hrefs: z.array(z.string()).min(1),
  ImageHashes: z.array(StringOrRef).max(10).optional(),
  VideoHashes: z.array(StringOrRef).optional(),
  SitelinksSetId: NumberOrRef.optional(),
  AdExtensions: z.object({ Items: z.array(NumberOrRef) }).optional(),
});

// Minimal stubs for ad types not yet fully implemented
const DynamicTextAdSchema = z.object({ Text: z.string() }).passthrough();
const MobileAppAdSchema = z.object({}).passthrough();
const ImageAdSchema = z
  .object({ AdImageHash: StringOrRef, Href: z.string() })
  .passthrough();

// Discriminated union by Type
export const AdSchema = z.discriminatedUnion("Type", [
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("TEXT_AD"),
    TextAd: TextAdSchema,
  }),
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("TEXT_IMAGE_AD"),
    TextImageAd: TextImageAdSchema,
  }),
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("RESPONSIVE_AD"),
    ResponsiveAd: ResponsiveAdSchema,
  }),
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("DYNAMIC_TEXT_AD"),
    DynamicTextAd: DynamicTextAdSchema,
  }),
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("MOBILE_APP_AD"),
    MobileAppAd: MobileAppAdSchema,
  }),
  z.object({
    variant_id: z.string().optional(),
    Type: z.literal("IMAGE_AD"),
    ImageAd: ImageAdSchema,
  }),
]);

// ============= Group =============
export const KeywordSchema = z.object({ Keyword: z.string().min(1) });

export const AutoTargetingCategoriesSchema = z.object({
  Items: z.array(
    z.object({ Category: AutoTargetingCategory, Value: YesNoEnum })
  ),
});

export const GroupSchema = z.object({
  group: z.object({
    Name: z.string().min(1),
    Type: AdGroupType,
    RegionIds: z.array(z.number()),
    AutoTargetingCategories: AutoTargetingCategoriesSchema.optional(),
  }),
  keywords: z.array(KeywordSchema).min(1).max(200),
  negative_keywords: z.object({ Items: z.array(z.string()) }).optional(),
  _meta: z
    .object({
      cluster_id: z.string().optional(),
      intent: z.string().optional(),
    })
    .passthrough()
    .optional(),
  ads: z.array(AdSchema).min(1).max(50),
});

// ============= SitelinksSet =============
export const SitelinkSchema = z.object({
  Title: z.string().max(30),
  Description: z.string().max(60).optional(),
  Href: z.string(),
});

export const SitelinksSetSchema = z.object({
  Sitelinks: z.array(SitelinkSchema).min(1).max(8),
});

// ============= PromoExtension =============
export const PromoExtensionSchema = z.object({
  AdExtension: z.object({
    PromoExtension: z.object({
      PromotionType: z.enum([
        "DISCOUNT",
        "BONUS",
        "FREE_DELIVERY",
        "SALE",
        "EVENT",
        "BUNDLE",
      ]),
      Discount: z.number().optional(),
      DiscountUnit: z.enum(["PERCENT", "RUB", "USD", "EUR"]).optional(),
      StartDate: z.string().optional(),
      EndDate: z.string(),
      PromoCode: z.string().optional(),
      Href: z.string().optional(),
    }),
  }),
});

// ============= Campaign =============
export const TextCampaignSchema = z.object({
  BiddingStrategy: z.object({
    Search: z.object({ BiddingStrategyType }).passthrough(),
    Network: z.object({ BiddingStrategyType }).passthrough(),
  }),
  Settings: z
    .array(z.object({ Option: z.string(), Value: z.string() }))
    .optional(),
  CounterIds: z.object({ Items: z.array(z.number()) }).optional(),
  PriorityGoals: z
    .object({
      Items: z.array(
        z.object({ GoalId: z.number(), Value: z.number().optional() })
      ),
    })
    .optional(),
  TrackingParams: z.string().optional(),
  NegativeKeywords: z.object({ Items: z.array(z.string()) }).optional(),
});

export const CampaignSchema = z.object({
  upload_strategy: z.enum(["one-per-cluster", "single-campaign"]).optional().default("one-per-cluster"),
  dedupe_by_name: z.boolean().optional().default(false),
  campaign: z.object({
    Name: z.string().min(1),
    Type: CampaignType,
    StartDate: z.string(),
    DailyBudget: z.object({
      Amount: z.number().int().positive(),
      Currency: z.enum([
        "RUB",
        "USD",
        "EUR",
        "BYN",
        "CHF",
        "KZT",
        "TRY",
        "UAH",
      ]),
    }),
    TextCampaign: TextCampaignSchema.optional(),
    // Other campaign type sub-objects as passthrough
    UnifiedPerformanceCampaign: z.unknown().optional(),
    MobileAppCampaign: z.unknown().optional(),
    DynamicTextCampaign: z.unknown().optional(),
  }),
  sitelinks_set: SitelinksSetSchema.optional(),
  promo_extension: PromoExtensionSchema.optional(),
  /**
   * Callouts (Уточнения) — ad extension texts attached to ads in this campaign.
   * Each string ≤ 25 chars (API limit per §5.2 of naming map).
   * Created via AdExtensions.add (CALLOUT type) before the pipeline runs; IDs
   * are wired into TextAd.AdExtensions.Items / TextImageAd.AdExtensions.Items.
   */
  callouts: z.array(z.string().max(25)).optional(),
  images: z
    .record(
      z.string(),
      z.object({
        source: z.enum(["url", "file", "base64"]),
        url: z.string().optional(),
        path: z.string().optional(),
        base64: z.string().optional(),
      })
    )
    .optional(),
});

// ============= Compatibility matrix =============
export const GROUP_AD_TYPE_MATRIX: Record<string, string[]> = {
  TEXT_AD_GROUP: [
    "TEXT_AD",
    "TEXT_IMAGE_AD",
    "TEXT_AD_BUILDER_AD",
    "CPC_VIDEO_AD",
    "IMAGE_AD",
  ],
  UNIFIED_AD_GROUP: [
    "RESPONSIVE_AD",
    "SHOPPING_AD",
    "LISTING_AD",
    "TEXT_IMAGE_AD",
    "TEXT_AD_BUILDER_AD",
  ],
  MOBILE_APP_AD_GROUP: ["MOBILE_APP_AD", "MOBILE_APP_IMAGE_AD"],
  DYNAMIC_TEXT_AD_GROUP: ["DYNAMIC_TEXT_AD"],
  SMART_AD_GROUP: ["SMART_AD"],
  CPM_BANNER_AD_GROUP: ["CPM_BANNER_AD"],
};

export function validateGroupAdCompatibility(
  groupType: string,
  adType: string
): boolean {
  return GROUP_AD_TYPE_MATRIX[groupType]?.includes(adType) ?? false;
}

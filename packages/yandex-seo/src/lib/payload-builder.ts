/**
 * Direct API payload builder — embeds 4 quirks discovered in b3-live-smoke.
 *
 * Quirks:
 *   1. RegionIds lives on AdGroup level, NOT on Campaign level.
 *   2. Search campaigns must use HIGHEST_POSITION or AVERAGE_CPC (not WB_DAILY_BUDGET)
 *      for the Search strategy; WB_DAILY_BUDGET is Network-only.
 *   3. AdImages.add requires a unique Name field; omitting it causes API rejection.
 *   4. StartDate must be in Moscow time (UTC+3); using UTC date can cause past-date
 *      rejection near midnight.
 *
 * Each builder function returns a ready-to-post JSON body for the generic
 * executeApiCall gateway. No typed wrappers — raw payload objects only.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute current date in Moscow time (UTC+3). Addresses quirk 4. */
function getMoscowDate(): string {
  const now = new Date();
  const mskOffset = 3 * 60 * 60 * 1000; // UTC+3 in milliseconds
  const msk = new Date(now.getTime() + mskOffset);
  return msk.toISOString().slice(0, 10); // YYYY-MM-DD, MSK
}

/** Generate a short random hex string for unique name suffixes. Addresses quirk 3. */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // Use Math.random as crypto is not needed for uniqueness here
  for (let i = 0; i < bytes; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// 1. Campaign create
// ---------------------------------------------------------------------------

/**
 * Build a Campaigns.add payload for Yandex Direct v5.
 *
 * Quirks addressed:
 *   - Quirk 1: RegionIds is NOT set here — it belongs on the AdGroup.
 *   - Quirk 2: Search strategy may only use HIGHEST_POSITION or AVERAGE_CPC;
 *              WB_DAILY_BUDGET is only valid for the Network side.
 *   - Quirk 4: StartDate is computed in Moscow time (UTC+3) to avoid
 *              past-date rejection near midnight.
 *
 * Daily budget is stored in micros (daily_budget_rub * 1_000_000).
 */
export function buildCampaignPayload(input: {
  type: "search" | "rsya" | "rsya-only";
  name: string;
  daily_budget_rub: number;
  bidding_strategy_type: "WB_DAILY_BUDGET" | "HIGHEST_POSITION" | "AVERAGE_CPC";
  counter_ids?: number[];
  start_date?: string;
  tracking_params?: string;
}): { method: "add"; params: { Campaigns: [unknown] } } {
  const startDate = input.start_date ?? getMoscowDate();
  const dailyBudgetMicros = input.daily_budget_rub * 1_000_000;

  let biddingStrategy: Record<string, unknown>;

  if (input.type === "search") {
    // Quirk 2: Search campaigns use HIGHEST_POSITION (manual CPC); WB_DAILY_BUDGET
    // is only valid for network placement. Network must be SERVING_OFF.
    const searchType = input.bidding_strategy_type === "WB_DAILY_BUDGET"
      ? "HIGHEST_POSITION"
      : input.bidding_strategy_type;

    const searchStrategy: Record<string, unknown> = { BiddingStrategyType: searchType };
    if (searchType === "AVERAGE_CPC") {
      searchStrategy["AverageCpc"] = { AverageCpc: dailyBudgetMicros };
    }

    biddingStrategy = {
      Search: searchStrategy,
      Network: { BiddingStrategyType: "SERVING_OFF" },
    };
  } else if (input.type === "rsya") {
    // RSYA: Search=SERVING_OFF, Network=WB_DAILY_BUDGET (or AVERAGE_CPC).
    const networkType = input.bidding_strategy_type === "HIGHEST_POSITION"
      ? "WB_DAILY_BUDGET"
      : input.bidding_strategy_type;

    const networkStrategy: Record<string, unknown> = { BiddingStrategyType: networkType };
    if (networkType === "WB_DAILY_BUDGET") {
      networkStrategy["WbMaximumClicks"] = { WeeklySpendingLimit: dailyBudgetMicros * 7 };
    } else if (networkType === "AVERAGE_CPC") {
      networkStrategy["AverageCpc"] = { AverageCpc: dailyBudgetMicros };
    }

    biddingStrategy = {
      Search: { BiddingStrategyType: "SERVING_OFF" },
      Network: networkStrategy,
    };
  } else {
    // rsya-only: Network=WB_DAILY_BUDGET only
    biddingStrategy = {
      Search: { BiddingStrategyType: "SERVING_OFF" },
      Network: {
        BiddingStrategyType: "WB_DAILY_BUDGET",
        WbMaximumClicks: { WeeklySpendingLimit: dailyBudgetMicros * 7 },
      },
    };
  }

  const textCampaign: Record<string, unknown> = {
    BiddingStrategy: biddingStrategy,
    Settings: [{ Option: "ADD_METRICA_TAG", Value: "YES" }],
  };

  if (input.counter_ids && input.counter_ids.length > 0) {
    textCampaign["CounterIds"] = { Items: input.counter_ids };
  }
  if (input.tracking_params !== undefined) {
    textCampaign["TrackingParams"] = input.tracking_params;
  }

  const campaign: Record<string, unknown> = {
    Name: input.name,
    StartDate: startDate,
    TextCampaign: textCampaign,
  };

  return {
    method: "add",
    params: { Campaigns: [campaign] },
  };
}

// ---------------------------------------------------------------------------
// 2. AdGroup create
// ---------------------------------------------------------------------------

/**
 * Build an AdGroups.add payload for Yandex Direct v5.
 *
 * Quirks addressed:
 *   - Quirk 1: RegionIds is set HERE at AdGroup level, not at Campaign level.
 *              The API ignores RegionIds on campaigns and requires it here.
 */
export function buildAdGroupPayload(input: {
  campaign_id: number;
  name: string;
  region_ids: number[];
}): { method: "add"; params: { AdGroups: [unknown] } } {
  return {
    method: "add",
    params: {
      AdGroups: [
        {
          CampaignId: input.campaign_id,
          Name: input.name,
          RegionIds: input.region_ids, // Quirk 1: lives here, not on Campaign
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Keyword add
// ---------------------------------------------------------------------------

/**
 * Build a Keywords.add payload for a single keyword.
 *
 * No quirks specific to this endpoint; it follows the standard v5 contract.
 * Pipeline calls this once per keyword.
 */
export function buildKeywordPayload(input: {
  ad_group_id: number;
  keyword_text: string;
}): { method: "add"; params: { Keywords: [unknown] } } {
  return {
    method: "add",
    params: {
      Keywords: [
        {
          AdGroupId: input.ad_group_id,
          Keyword: input.keyword_text,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 4. TGO ad (TextAd — search)
// ---------------------------------------------------------------------------

/**
 * Build an Ads.add payload for a TGO (text-only) ad on the search network.
 *
 * No network-specific quirks beyond the standard TextAd contract.
 * Mobile is set to NO (Direct best practice for search TGO ads).
 *
 * Optional extension fields:
 *   - sitelinks_set_id: wires SitelinkSetId (singular) inside TextAd per Direct v5 API — verified live
 *   - ad_extensions: wires AdExtensions.Items (callout IDs) into TextAd (ad-level per naming map §3.2)
 */
export function buildAdTgoPayload(input: {
  ad_group_id: number;
  title: string;
  title2?: string;
  text: string;
  href: string;
  display_url_path?: string;
  sitelinks_set_id?: number;
  ad_extensions?: number[];
}): { method: "add"; params: { Ads: [unknown] } } {
  const textAd: Record<string, unknown> = {
    Title: input.title,
    Text: input.text,
    Href: input.href,
    Mobile: "NO",
  };

  if (input.title2 !== undefined) {
    textAd["Title2"] = input.title2;
  }
  if (input.display_url_path !== undefined) {
    textAd["DisplayUrlPath"] = input.display_url_path;
  }
  // SitelinkSetId (singular) inside TextAd per Direct v5 API — verified live
  if (input.sitelinks_set_id !== undefined) {
    textAd["SitelinkSetId"] = input.sitelinks_set_id;
  }
  if (input.ad_extensions && input.ad_extensions.length > 0) {
    textAd["AdExtensions"] = { Items: input.ad_extensions };
  }

  const ad: Record<string, unknown> = {
    AdGroupId: input.ad_group_id,
    TextAd: textAd,
  };

  return {
    method: "add",
    params: {
      Ads: [ad],
    },
  };
}

// ---------------------------------------------------------------------------
// 5. RSYA ad (TextImageAd — display network)
// ---------------------------------------------------------------------------

/**
 * Build an Ads.add payload for an RSYA (display network) ad.
 *
 * Uses TextImageAd type which requires an uploaded image hash.
 * No additional quirks beyond standard TextImageAd contract.
 *
 * Optional extension fields:
 *   - sitelinks_set_id: wires SitelinkSetId (singular) inside TextImageAd per Direct v5 API — verified live
 *   - ad_extensions: wires AdExtensions.Items (callout IDs) into TextImageAd (ad-level per naming map §3.3)
 */
export function buildAdRsyaPayload(input: {
  ad_group_id: number;
  ad_image_hash: string;
  title: string;
  title2?: string;
  text: string;
  href: string;
  sitelinks_set_id?: number;
  ad_extensions?: number[];
}): { method: "add"; params: { Ads: [unknown] } } {
  const textImageAd: Record<string, unknown> = {
    AdImageHash: input.ad_image_hash,
    Title: input.title,
    Text: input.text,
    Href: input.href,
  };

  if (input.title2 !== undefined) {
    textImageAd["Title2"] = input.title2;
  }
  // SitelinkSetId (singular) inside TextImageAd per Direct v5 API — verified live
  if (input.sitelinks_set_id !== undefined) {
    textImageAd["SitelinkSetId"] = input.sitelinks_set_id;
  }
  if (input.ad_extensions && input.ad_extensions.length > 0) {
    textImageAd["AdExtensions"] = { Items: input.ad_extensions };
  }

  const ad: Record<string, unknown> = {
    AdGroupId: input.ad_group_id,
    TextImageAd: textImageAd,
  };

  return {
    method: "add",
    params: {
      Ads: [ad],
    },
  };
}

// ---------------------------------------------------------------------------
// 6. Image upload
// ---------------------------------------------------------------------------

/**
 * Build an AdImages.add payload with a unique Name field.
 *
 * Quirks addressed:
 *   - Quirk 3: The Name field is REQUIRED by the API. Omitting it causes
 *              immediate rejection. A unique name is generated using
 *              Date.now() + random hex to prevent collision across pipeline runs.
 */
export function buildImageUploadPayload(input: {
  base64: string;
  format: "JPEG" | "PNG";
}): { method: "add"; params: { AdImages: [{ ImageData: string; Name: string }] } } {
  const name = `phase-${Date.now()}-${randomHex(4)}`;

  return {
    method: "add",
    params: {
      AdImages: [
        {
          ImageData: input.base64,
          Name: name,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Metrika goal link (campaign update)
// ---------------------------------------------------------------------------

/**
 * Build a Campaigns.update payload to link Metrika counter IDs and goals.
 *
 * Strategy-dependent shape:
 *   - WB_DAILY_BUDGET: uses CounterIds + PriorityGoals (goal value weight).
 *   - AVERAGE_CPA / AVERAGE_ROI / PAY_FOR_CONVERSION: uses CounterIds +
 *     BiddingStrategy with the goal ID embedded in the Search strategy object.
 *
 * No direct quirk number, but this encodes the correct update shape that
 * bypasses typed wrapper limitations discovered during b3-live-smoke.
 */
export function buildMetrikaUpdatePayload(input: {
  campaign_id: number;
  counter_ids: number[];
  goal_ids: number[];
  strategy_type: "WB_DAILY_BUDGET" | "AVERAGE_CPA" | "AVERAGE_ROI" | "PAY_FOR_CONVERSION";
}): { method: "update"; params: { Campaigns: [unknown] } } {
  const textCampaign: Record<string, unknown> = {
    CounterIds: { Items: input.counter_ids },
  };

  if (input.strategy_type === "WB_DAILY_BUDGET") {
    textCampaign["PriorityGoals"] = {
      Items: input.goal_ids.map((id) => ({ GoalId: id, Value: 100 })),
    };
  } else {
    // AVERAGE_CPA, AVERAGE_ROI, PAY_FOR_CONVERSION — goal ID in Search strategy
    const goalId = input.goal_ids[0];
    const strategyObj: Record<string, unknown> = { GoalId: goalId };

    let strategyType: string;
    if (input.strategy_type === "AVERAGE_CPA") {
      strategyType = "AverageCpa";
    } else if (input.strategy_type === "AVERAGE_ROI") {
      strategyType = "AverageRoi";
    } else {
      strategyType = "PayForConversion";
    }

    textCampaign["BiddingStrategy"] = {
      Search: {
        BiddingStrategyType: input.strategy_type,
        [strategyType]: strategyObj,
      },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    };
  }

  return {
    method: "update",
    params: {
      Campaigns: [
        {
          Id: input.campaign_id,
          TextCampaign: textCampaign,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// 8. Sitelinks set create
// ---------------------------------------------------------------------------

/**
 * Build a Sitelinks.add payload for Yandex Direct v5.
 *
 * Direct v5 API requires sitelinks wrapped in a SitelinksSets array:
 *   { method: "add", params: { SitelinksSets: [{ Sitelinks: [...] }] } }
 *
 * Each sitelink requires at minimum a Title and Href; Description is optional.
 */
export function buildSitelinksSetPayload(input: {
  Sitelinks: Array<{ Title: string; Description?: string; Href: string }>;
}): { method: "add"; params: { SitelinksSets: Array<{ Sitelinks: typeof input.Sitelinks }> } } {
  return { method: "add", params: { SitelinksSets: [{ Sitelinks: input.Sitelinks }] } };
}

// ---------------------------------------------------------------------------
// 9a. Callout (Уточнение) create
// ---------------------------------------------------------------------------

/**
 * Build an AdExtensions.add payload for one or more Callout extensions.
 *
 * Per naming-map §5.2:
 *   Endpoint: POST /json/v5/adextensions (type: CALLOUT)
 *   Each callout text ≤ 25 chars. IDs returned are wired via AdExtensions.Items on TextAd/TextImageAd.
 */
export function buildCalloutPayload(input: {
  callout_texts: string[];
}): { method: "add"; params: { AdExtensions: Array<{ Callout: { CalloutText: string } }> } } {
  return {
    method: "add",
    params: {
      AdExtensions: input.callout_texts.map((text) => ({
        Callout: { CalloutText: text },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// 9. Promo extension create
// ---------------------------------------------------------------------------

/**
 * Build an AdExtensions.add payload for a PromoExtension in Yandex Direct v5.
 *
 * PromoExtension surfaces a promotional offer (discount, promo code, etc.)
 * alongside the ad. EndDate is required; all other fields are optional.
 */
export function buildPromoExtensionPayload(input: {
  PromoExtension: {
    PromotionType: string;
    Discount?: number;
    DiscountUnit?: string;
    StartDate?: string;
    EndDate: string;
    PromoCode?: string;
    Href?: string;
  };
}): { method: "add"; params: { AdExtensions: Array<{ PromoExtension: typeof input.PromoExtension }> } } {
  return {
    method: "add",
    params: { AdExtensions: [{ PromoExtension: input.PromoExtension }] },
  };
}

// ---------------------------------------------------------------------------
// 10. ResponsiveAd create
// ---------------------------------------------------------------------------

/**
 * Build an Ads.add payload for a ResponsiveAd — РСЯ smart ad, v501 endpoint only, verified live.
 *
 * MUST be posted to /json/v501/ads (NOT /json/v5/ads — v5 returns error 3500).
 * Proven-correct schema (live-verified):
 *   - Titles: string[]        — required, 1-7 items
 *   - Texts: string[]         — required, 1-3 items
 *   - Href: string            — singular URL (NOT Hrefs array)
 *   - AdImageHashes: string[] — required when images used, 1-5 items
 *                              (NOT ImageHashes, NOT AdImageHash)
 *   - SitelinkSetId: number   — optional, singular
 *   - AdExtensionIds: number[]— optional, array of IDs directly
 *                              (NOT AdExtensions:{Items})
 *   - No Title2s (not in ResponsiveAd spec)
 */
export function buildResponsiveAdPayload(input: {
  ad_group_id: number;
  Titles: string[];
  Texts: string[];
  Href: string;
  AdImageHashes?: string[];
  VideoHashes?: string[];
  SitelinkSetId?: number;
  AdExtensionIds?: number[];
}): { method: "add"; params: { Ads: Array<unknown> } } {
  const responsiveAd: Record<string, unknown> = {
    Titles: input.Titles,
    Texts: input.Texts,
    Href: input.Href,
  };
  if (input.AdImageHashes && input.AdImageHashes.length > 0) {
    responsiveAd["AdImageHashes"] = input.AdImageHashes.slice(0, 5);
  }
  if (input.VideoHashes && input.VideoHashes.length > 0) {
    responsiveAd["VideoHashes"] = input.VideoHashes;
  }
  if (input.SitelinkSetId !== undefined) {
    responsiveAd["SitelinkSetId"] = input.SitelinkSetId;
  }
  if (input.AdExtensionIds && input.AdExtensionIds.length > 0) {
    responsiveAd["AdExtensionIds"] = input.AdExtensionIds;
  }

  return {
    method: "add",
    params: {
      Ads: [{
        AdGroupId: input.ad_group_id,
        ResponsiveAd: responsiveAd,
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// 11. Auto-targeting update on AdGroup
// ---------------------------------------------------------------------------

/**
 * Build an AdGroups.update payload to configure auto-targeting categories.
 *
 * The sub-object name on AdGroup differs by group type:
 *   - TEXT_AD_GROUP         → TextAdGroupAutoTargeting
 *   - UNIFIED_AD_GROUP      → UnifiedAdGroupAutoTargeting
 *   - MOBILE_APP_AD_GROUP   → MobileAppAdGroupAutoTargeting
 *
 * Each category entry is { Category: string; Value: "YES" | "NO" }.
 */
export function buildAutoTargetingUpdatePayload(input: {
  ad_group_id: number;
  group_type: "TEXT_AD_GROUP" | "UNIFIED_AD_GROUP" | "MOBILE_APP_AD_GROUP";
  categories: Array<{ Category: string; Value: "YES" | "NO" }>;
}): { method: "update"; params: { AdGroups: Array<unknown> } } {
  const autoTargeting = { Items: input.categories };
  const adGroup: Record<string, unknown> = { Id: input.ad_group_id };

  if (input.group_type === "TEXT_AD_GROUP") {
    adGroup["TextAdGroupAutoTargeting"] = autoTargeting;
  } else if (input.group_type === "UNIFIED_AD_GROUP") {
    adGroup["UnifiedAdGroupAutoTargeting"] = autoTargeting;
  } else {
    // MOBILE_APP_AD_GROUP
    adGroup["MobileAppAdGroupAutoTargeting"] = autoTargeting;
  }

  return { method: "update", params: { AdGroups: [adGroup] } };
}

// ---------------------------------------------------------------------------
// 12. UnifiedPerformanceCampaign create
// ---------------------------------------------------------------------------

/**
 * Build a Campaigns.add payload for a UnifiedPerformanceCampaign (UPC) in
 * Yandex Direct v5.
 *
 * UPC is a performance-max style campaign that replaces separate search/network
 * splits. Budget is stored in micros (daily_budget_rub * 1_000_000).
 * StartDate defaults to today in Moscow time (UTC+3) when not provided.
 *
 * Optional counter_ids, goal_ids (mapped to PriorityGoals), and tracking_params
 * are added to the UPC block only when present.
 */
export function buildUnifiedPerformanceCampaignPayload(input: {
  name: string;
  daily_budget_rub: number;
  bidding_strategy_type: string;
  counter_ids?: number[];
  goal_ids?: number[];
  start_date?: string;
  tracking_params?: string;
}): { method: "add"; params: { Campaigns: Array<unknown> } } {
  const upc: Record<string, unknown> = {
    BiddingStrategy: {
      Search: { BiddingStrategyType: input.bidding_strategy_type },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    },
    DailyBudget: {
      Amount: input.daily_budget_rub * 1_000_000,
      Currency: "RUB",
    },
  };

  if (input.counter_ids) upc["CounterIds"] = { Items: input.counter_ids };
  if (input.goal_ids) {
    upc["PriorityGoals"] = {
      Items: input.goal_ids.map((GoalId) => ({ GoalId, Value: 100 })),
    };
  }
  if (input.tracking_params) upc["TrackingParams"] = input.tracking_params;

  return {
    method: "add",
    params: {
      Campaigns: [{
        Name: input.name,
        StartDate: input.start_date ?? getMoscowDate(),
        UnifiedPerformanceCampaign: upc,
      }],
    },
  };
}

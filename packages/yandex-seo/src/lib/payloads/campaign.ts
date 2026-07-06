/**
 * Direct API payload builders — Campaign create/update.
 */

import { getMoscowDate } from "./_helpers.js";

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
// 12. UnifiedPerformanceCampaign create
// ---------------------------------------------------------------------------

/**
 * Build a Campaigns.add payload for a Единая перформанс-кампания (ЕПК /
 * UnifiedCampaign). This is the ONLY campaign type that serves combinatorial
 * RESPONSIVE_AD on search. Post to /json/v501/campaigns (v5 does not accept it).
 * Verified live against the API: the `UnifiedCampaign` structure (not a `Type`
 * field) selects ЕПК; `DailyBudget` sits at the Campaign level; its `Amount` is
 * account-currency micros (× 1_000_000) with NO `Currency` sub-field — the
 * currency follows the account, so this is currency-agnostic (works for USD, RUB…).
 * `Search` must be an active strategy or combinatorial ads have nowhere to serve.
 * StartDate defaults to today in Moscow time (UTC+3) when not provided.
 */
export function buildUnifiedCampaignPayload(input: {
  name: string;
  daily_budget_micros?: number;         // account-currency micros; applied ONLY with a MANUAL search strategy
  search_strategy_type?: string;        // default HIGHEST_POSITION (used only when bidding_strategy is absent)
  network_mode?: "off" | "network";     // simple placement toggle when bidding_strategy is absent
  bidding_strategy?: Record<string, unknown>; // full { Search, Network } BiddingStrategy verbatim (ЕПК-valid);
                                        // auto strategies carry WeeklySpendLimit/BidCeiling inside their own struct.
  time_targeting?: Record<string, unknown>;   // TimeTargeting: hourly schedule + bid coefficients
  counter_ids?: number[];
  goal_ids?: number[];
  priority_goals?: Array<{ goal_id: number; value?: number }>; // per-goal conversion Value (ценность конверсии); takes precedence over goal_ids
  start_date?: string;
  tracking_params?: string;
}): { method: "add"; params: { Campaigns: Array<unknown> } } {
  // Placement / strategy: verbatim when provided, else a simple default from search_strategy_type + network_mode.
  const biddingStrategy: Record<string, unknown> = input.bidding_strategy ?? {
    Search: { BiddingStrategyType: input.search_strategy_type ?? "HIGHEST_POSITION" },
    // Network valid types (ЕПК): AVERAGE_CPC, AVERAGE_CPA, PAY_FOR_CONVERSION, WB_MAXIMUM_CONVERSION_RATE.
    // The simple toggle only supports off; enabling networks requires a full bidding_strategy with the
    // network strategy's settings struct (Yandex rejects a bare network type without settings).
    Network: { BiddingStrategyType: "SERVING_OFF" },
  };

  const unified: Record<string, unknown> = {
    BiddingStrategy: biddingStrategy,
    Settings: [{ Option: "ADD_METRICA_TAG", Value: "YES" }],
  };

  if (input.counter_ids) unified["CounterIds"] = { Items: input.counter_ids };
  // PriorityGoals on CREATE take NO Operation (create is implicitly a full set).
  if (input.priority_goals && input.priority_goals.length > 0) {
    unified["PriorityGoals"] = {
      Items: input.priority_goals.map((g) => ({ GoalId: g.goal_id, ...(g.value !== undefined ? { Value: g.value } : {}) })),
    };
  } else if (input.goal_ids) {
    unified["PriorityGoals"] = {
      Items: input.goal_ids.map((GoalId) => ({ GoalId, Value: 100 })),
    };
  }
  if (input.tracking_params) unified["TrackingParams"] = input.tracking_params;

  const campaign: Record<string, unknown> = {
    Name: input.name,
    StartDate: input.start_date ?? getMoscowDate(),
    UnifiedCampaign: unified,
  };

  // TimeTargeting is a Campaign-level field (sibling of UnifiedCampaign), NOT inside it.
  // Requires ConsiderWorkingWeekends; callers should include it in the passed structure.
  if (input.time_targeting) campaign["TimeTargeting"] = input.time_targeting;

  // Campaign-level DailyBudget is ONLY valid with manual strategies. Auto strategies (WB_*/AVERAGE_*)
  // carry WeeklySpendLimit inside their own struct — attaching DailyBudget there errors 4000.
  const searchType = (biddingStrategy["Search"] as { BiddingStrategyType?: string } | undefined)?.BiddingStrategyType;
  const isManualSearch = searchType === undefined || searchType === "HIGHEST_POSITION";
  if (isManualSearch && input.daily_budget_micros !== undefined) {
    campaign["DailyBudget"] = { Amount: input.daily_budget_micros, Mode: "STANDARD" };
  }

  return { method: "add", params: { Campaigns: [campaign] } };
}

// ---------------------------------------------------------------------------
// 14. Point-edit update builders — surgical Campaigns/AdGroups/Ads.update
// ---------------------------------------------------------------------------

/**
 * Build a Campaigns.update payload for a ЕПК (UnifiedCampaign), sent to
 * /json/v501/campaigns. Fields live-verified against the API:
 *   Campaign top level : Name, DailyBudget{Amount,Mode}, ExcludedSites{Items},
 *                        NegativeKeywords{Items}, Notification{EmailSettings,SmsSettings},
 *                        TimeTargeting.
 *   UnifiedCampaign    : BiddingStrategy, AttributionModel (short codes
 *                        LC/LSC/FC/LYDC/LSCCD/FCCD/LYDCCD/AUTO), TrackingParams,
 *                        Settings[{Option,Value}] (ExtendedGeoTargeting = the
 *                        ENABLE_*_AREA_TARGETING options), CounterIds{Items},
 *                        PriorityGoals{Items}.
 * Frequency capping is NOT settable via the API for ЕПК (all field names rejected).
 * Only provided fields are emitted — everything else is left untouched.
 */
export function buildCampaignUpdatePayload(input: {
  campaign_id: number | string;
  name?: string;
  daily_budget_micros?: number;
  excluded_sites?: string[];
  negative_keywords?: string[];
  notification?: Record<string, unknown>;
  time_targeting?: Record<string, unknown>;
  bidding_strategy?: Record<string, unknown>;
  attribution_model?: string;
  tracking_params?: string;
  settings?: Array<{ Option: string; Value: string }>;
  counter_ids?: number[];
  goal_ids?: number[];
  priority_goals?: Array<{ goal_id: number; value?: number }>; // per-goal conversion Value; takes precedence over goal_ids
  raw_fields?: Record<string, unknown>;          // merged verbatim at campaign level
  raw_unified_fields?: Record<string, unknown>;  // merged verbatim inside UnifiedCampaign
}): { method: "update"; params: { Campaigns: Array<unknown> } } {
  const campaign: Record<string, unknown> = { Id: input.campaign_id };
  if (input.name !== undefined) campaign["Name"] = input.name;
  if (input.daily_budget_micros !== undefined)
    campaign["DailyBudget"] = { Amount: input.daily_budget_micros, Mode: "STANDARD" };
  if (input.excluded_sites !== undefined) campaign["ExcludedSites"] = { Items: input.excluded_sites };
  if (input.negative_keywords !== undefined) campaign["NegativeKeywords"] = { Items: input.negative_keywords };
  if (input.notification !== undefined) campaign["Notification"] = input.notification;
  if (input.time_targeting !== undefined) campaign["TimeTargeting"] = input.time_targeting;

  const unified: Record<string, unknown> = {};
  if (input.bidding_strategy !== undefined) unified["BiddingStrategy"] = input.bidding_strategy;
  if (input.attribution_model !== undefined) unified["AttributionModel"] = input.attribution_model;
  if (input.tracking_params !== undefined) unified["TrackingParams"] = input.tracking_params;
  if (input.settings !== undefined) unified["Settings"] = input.settings;
  if (input.counter_ids !== undefined) unified["CounterIds"] = { Items: input.counter_ids };
  // PriorityGoals on UPDATE require Operation per item, and only "SET" is supported
  // (Yandex 3500 for ADD/REMOVE; 8000 "Operation omitted" if missing).
  if (input.priority_goals && input.priority_goals.length > 0) {
    unified["PriorityGoals"] = {
      Items: input.priority_goals.map((g) => ({ GoalId: g.goal_id, Operation: "SET", ...(g.value !== undefined ? { Value: g.value } : {}) })),
    };
  } else if (input.goal_ids !== undefined) {
    unified["PriorityGoals"] = { Items: input.goal_ids.map((GoalId) => ({ GoalId, Operation: "SET", Value: 100 })) };
  }
  if (input.raw_unified_fields) Object.assign(unified, input.raw_unified_fields);
  if (Object.keys(unified).length > 0) campaign["UnifiedCampaign"] = unified;

  if (input.raw_fields) Object.assign(campaign, input.raw_fields);
  return { method: "update", params: { Campaigns: [campaign] } };
}

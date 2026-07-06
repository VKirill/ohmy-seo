import { z } from "zod";

// Shared zod schema for the friendly typed `strategy` param — used by create_campaign,
// update_campaign, their registrations, and the YAML bundle epk_settings, so the shape
// is defined once. Maps (via buildEpkBiddingStrategy) to a live-compatible { Search, Network }.
export const strategySpecSchema = z
  .object({
    type: z
      .enum(["manual", "serving_off", "max_clicks", "avg_cpc", "max_conversions", "avg_cpa", "pay_for_conversion", "avg_crr", "pay_for_conversion_crr"])
      .describe(
        "manual=HIGHEST_POSITION (search-only, allows daily budget); max_clicks=WB_MAXIMUM_CLICKS (weekly budget); " +
          "avg_cpc=AVERAGE_CPC; max_conversions=WB_MAXIMUM_CONVERSION_RATE (weekly budget, optional goal); " +
          "avg_cpa=AVERAGE_CPA (needs goal+avg_cpa_micros); pay_for_conversion=PAY_FOR_CONVERSION (needs goal+cpa_micros, pay only per conversion); " +
          "avg_crr / pay_for_conversion_crr = доля рекламных расходов (needs goal+crr); serving_off=paused.",
      ),
    placement: z
      .enum(["search", "network", "both"])
      .optional()
      .describe("Where the strategy serves: search-only, network(РСЯ)-only, or both (default 'both' for auto; manual is always search-only)."),
    weekly_budget_micros: z.number().int().positive().optional().describe("WeeklySpendLimit in ACCOUNT-currency micros (auto strategies; ≥ MinimumWeeklySpendLimit)"),
    bid_ceiling_micros: z.number().int().positive().optional().describe("Optional BidCeiling (max bid) in micros"),
    goal_id: z.number().int().positive().optional().describe("Metrika goal ID (required for conversion strategies: avg_cpa/pay_for_conversion/avg_crr/pay_for_conversion_crr; optional for max_conversions)"),
    avg_cpc_micros: z.number().int().positive().optional().describe("Target average CPC in micros (avg_cpc)"),
    avg_cpa_micros: z.number().int().positive().optional().describe("Target average CPA in micros (avg_cpa)"),
    cpa_micros: z.number().int().positive().optional().describe("Fixed cost-per-conversion in micros (pay_for_conversion)"),
    crr: z.number().int().positive().optional().describe("Target cost-revenue ratio percent (avg_crr / pay_for_conversion_crr)"),
  })
  .describe("Typed bidding strategy. Builds a live-compatible ЕПК { Search, Network } — takes precedence over search_strategy / raw bidding_strategy.");

export type StrategySpecInput = z.infer<typeof strategySpecSchema>;

/**
 * Typed ЕПК (UnifiedCampaign) bidding-strategy builder.
 *
 * Compatibility model verified live against the API:
 *   - The strategy lives on ONE side (Search OR Network); the other side is
 *     `SERVING_OFF` (single placement) or `NETWORK_DEFAULT` (both — networks follow Search).
 *   - `HIGHEST_POSITION` (manual) pairs ONLY with Network `SERVING_OFF` (HIGHEST + NETWORK_DEFAULT
 *     is "not compatible"). Two different auto strategies on both sides = "not compatible".
 *   - Conversion strategies (avg_cpa / max_conversions / pay_for_conversion / *_crr) require a
 *     real Metrika `goal_id`. Daily budget is meaningful only for manual — auto strategies use
 *     `weekly_budget_micros` (WeeklySpendLimit); attaching DailyBudget to an auto strategy warns (10162).
 *
 * Full ЕПК Search enum: AVERAGE_CPC, AVERAGE_CPA, PAY_FOR_CONVERSION, WB_MAXIMUM_CONVERSION_RATE,
 * HIGHEST_POSITION, SERVING_OFF, WB_MAXIMUM_CLICKS, AVERAGE_CRR, PAY_FOR_CONVERSION_CRR, MAX_PROFIT,
 * PAY_FOR_CONVERSION_MAX_PROFIT, AVERAGE_CPA_MULTIPLE_GOALS, PAY_FOR_CONVERSION_MULTIPLE_GOALS.
 * (There is no AVERAGE_ROI on ЕПК — use the CRR / доля-рекламных-расходов strategies instead.)
 */

export type StrategyType =
  | "manual"                 // HIGHEST_POSITION — search-only, manual, allows daily budget
  | "serving_off"            // both sides off (paused)
  | "max_clicks"             // WB_MAXIMUM_CLICKS — max clicks within a weekly budget
  | "avg_cpc"                // AVERAGE_CPC — hold an average CPC
  | "max_conversions"        // WB_MAXIMUM_CONVERSION_RATE — max conversions within a weekly budget
  | "avg_cpa"                // AVERAGE_CPA — hold an average cost per conversion (needs goal)
  | "pay_for_conversion"     // PAY_FOR_CONVERSION — pay only per conversion at a fixed CPA (needs goal)
  | "avg_crr"                // AVERAGE_CRR — hold an average cost-revenue ratio / ДРР (needs goal)
  | "pay_for_conversion_crr";// PAY_FOR_CONVERSION_CRR — pay per conversion at a target CRR (needs goal)

export type StrategyPlacement = "search" | "network" | "both";

export interface StrategySpec {
  type: StrategyType;
  placement?: StrategyPlacement; // default: "both" for auto; forced search-only for manual
  weekly_budget_micros?: number;
  bid_ceiling_micros?: number;
  goal_id?: number;
  avg_cpc_micros?: number;
  avg_cpa_micros?: number;
  cpa_micros?: number;
  crr?: number; // percent for CRR strategies
}

// Returned as a plain Record so it drops straight into buildUnifiedCampaignPayload /
// buildCampaignUpdatePayload's `bidding_strategy: Record<string, unknown>` slot.
export type BiddingStrategyStruct = Record<string, unknown>;

function req<T>(v: T | undefined, field: string, type: string): T {
  if (v === undefined || v === null) throw new Error(`strategy type "${type}" requires "${field}"`);
  return v;
}

/** Map an auto strategy type → { BiddingStrategyType, <SettingsKey>: {settings} }. */
function buildAuto(spec: StrategySpec): Record<string, unknown> {
  const t = spec.type;
  const ceil = spec.bid_ceiling_micros !== undefined ? { BidCeiling: spec.bid_ceiling_micros } : {};
  const wsl = spec.weekly_budget_micros !== undefined ? { WeeklySpendLimit: spec.weekly_budget_micros } : {};
  switch (t) {
    case "max_clicks":
      return { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: req(spec.weekly_budget_micros, "weekly_budget_micros", t), ...ceil } };
    case "avg_cpc":
      return { BiddingStrategyType: "AVERAGE_CPC", AverageCpc: { AverageCpc: req(spec.avg_cpc_micros, "avg_cpc_micros", t), ...wsl } };
    case "max_conversions":
      return { BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE", WbMaximumConversionRate: { WeeklySpendLimit: req(spec.weekly_budget_micros, "weekly_budget_micros", t), ...(spec.goal_id !== undefined ? { GoalId: spec.goal_id } : {}), ...ceil } };
    case "avg_cpa":
      return { BiddingStrategyType: "AVERAGE_CPA", AverageCpa: { AverageCpa: req(spec.avg_cpa_micros, "avg_cpa_micros", t), GoalId: req(spec.goal_id, "goal_id", t), ...wsl, ...ceil } };
    case "pay_for_conversion":
      return { BiddingStrategyType: "PAY_FOR_CONVERSION", PayForConversion: { Cpa: req(spec.cpa_micros, "cpa_micros", t), GoalId: req(spec.goal_id, "goal_id", t) } };
    case "avg_crr":
      return { BiddingStrategyType: "AVERAGE_CRR", AverageCrr: { Crr: req(spec.crr, "crr", t), GoalId: req(spec.goal_id, "goal_id", t), ...wsl } };
    case "pay_for_conversion_crr":
      return { BiddingStrategyType: "PAY_FOR_CONVERSION_CRR", PayForConversionCrr: { Crr: req(spec.crr, "crr", t), GoalId: req(spec.goal_id, "goal_id", t) } };
    default:
      throw new Error(`unsupported auto strategy type "${t}"`);
  }
}

/**
 * Build the ЕПК { Search, Network } BiddingStrategy from a friendly spec, applying the
 * live-verified compatibility rules so the API never returns "not compatible".
 */
export function buildEpkBiddingStrategy(spec: StrategySpec): BiddingStrategyStruct {
  const OFF = { BiddingStrategyType: "SERVING_OFF" };

  if (spec.type === "manual") {
    // HIGHEST_POSITION only pairs with SERVING_OFF (search-only).
    return { Search: { BiddingStrategyType: "HIGHEST_POSITION" }, Network: { ...OFF } };
  }
  if (spec.type === "serving_off") {
    return { Search: { ...OFF }, Network: { ...OFF } };
  }

  const strat = buildAuto(spec);
  const placement = spec.placement ?? "both";
  if (placement === "network") return { Search: { ...OFF }, Network: strat };
  if (placement === "search") return { Search: strat, Network: { ...OFF } };
  // both — strategy on Search, networks follow via NETWORK_DEFAULT
  return { Search: strat, Network: { BiddingStrategyType: "NETWORK_DEFAULT" } };
}

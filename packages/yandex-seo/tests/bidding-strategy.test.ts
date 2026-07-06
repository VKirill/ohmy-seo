import { describe, it, expect } from "vitest";

// buildEpkBiddingStrategy is re-exported from the payload-builder barrel.
// The barrel and its ./payloads/ modules are pure (no mcp-core/api-gateway
// side-effects), so no vi.mock scaffolding is needed here.
import { buildEpkBiddingStrategy } from "../src/lib/payload-builder.js";

const OFF = { BiddingStrategyType: "SERVING_OFF" };
const NETWORK_DEFAULT = { BiddingStrategyType: "NETWORK_DEFAULT" };

describe("buildEpkBiddingStrategy — manual (HIGHEST_POSITION)", () => {
  it("maps { type:'manual' } to HIGHEST_POSITION Search + SERVING_OFF Network", () => {
    expect(buildEpkBiddingStrategy({ type: "manual" })).toEqual({
      Search: { BiddingStrategyType: "HIGHEST_POSITION" },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    });
  });

  it("IGNORES placement for manual (placement:'both' still yields Network SERVING_OFF)", () => {
    expect(buildEpkBiddingStrategy({ type: "manual", placement: "both" })).toEqual({
      Search: { BiddingStrategyType: "HIGHEST_POSITION" },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    });
  });
});

describe("buildEpkBiddingStrategy — serving_off", () => {
  it("turns both sides off", () => {
    expect(buildEpkBiddingStrategy({ type: "serving_off" })).toEqual({
      Search: { ...OFF },
      Network: { ...OFF },
    });
  });
});

describe("buildEpkBiddingStrategy — max_clicks (WB_MAXIMUM_CLICKS)", () => {
  it("default placement 'both' → Search strategy, Network NETWORK_DEFAULT", () => {
    const result = buildEpkBiddingStrategy({ type: "max_clicks", weekly_budget_micros: 70000000 });
    const search = result.Search as Record<string, unknown>;
    expect(search.BiddingStrategyType).toBe("WB_MAXIMUM_CLICKS");
    expect(search.WbMaximumClicks).toEqual({ WeeklySpendLimit: 70000000 });
    expect(result.Network).toEqual({ BiddingStrategyType: "NETWORK_DEFAULT" });
  });

  it("bid_ceiling_micros is folded into WbMaximumClicks as BidCeiling", () => {
    const result = buildEpkBiddingStrategy({
      type: "max_clicks",
      weekly_budget_micros: 70000000,
      bid_ceiling_micros: 10000000,
    });
    const search = result.Search as Record<string, unknown>;
    expect(search.WbMaximumClicks).toEqual({ WeeklySpendLimit: 70000000, BidCeiling: 10000000 });
  });
});

describe("buildEpkBiddingStrategy — placement variants (avg_cpc)", () => {
  it("placement:'search' → Search AVERAGE_CPC, Network SERVING_OFF", () => {
    expect(
      buildEpkBiddingStrategy({ type: "avg_cpc", avg_cpc_micros: 30000, placement: "search" }),
    ).toEqual({
      Search: { BiddingStrategyType: "AVERAGE_CPC", AverageCpc: { AverageCpc: 30000 } },
      Network: { ...OFF },
    });
  });

  it("placement:'network' → Search SERVING_OFF, Network AVERAGE_CPC", () => {
    expect(
      buildEpkBiddingStrategy({ type: "avg_cpc", avg_cpc_micros: 30000, placement: "network" }),
    ).toEqual({
      Search: { ...OFF },
      Network: { BiddingStrategyType: "AVERAGE_CPC", AverageCpc: { AverageCpc: 30000 } },
    });
  });

  it("placement:'both' → Search AVERAGE_CPC, Network NETWORK_DEFAULT", () => {
    expect(
      buildEpkBiddingStrategy({ type: "avg_cpc", avg_cpc_micros: 30000, placement: "both" }),
    ).toEqual({
      Search: { BiddingStrategyType: "AVERAGE_CPC", AverageCpc: { AverageCpc: 30000 } },
      Network: { ...NETWORK_DEFAULT },
    });
  });

  it("weekly_budget_micros is folded into the AverageCpc struct as WeeklySpendLimit", () => {
    expect(
      buildEpkBiddingStrategy({
        type: "avg_cpc",
        avg_cpc_micros: 30000,
        weekly_budget_micros: 70000000,
        placement: "search",
      }),
    ).toEqual({
      Search: {
        BiddingStrategyType: "AVERAGE_CPC",
        AverageCpc: { AverageCpc: 30000, WeeklySpendLimit: 70000000 },
      },
      Network: { ...OFF },
    });
  });
});

describe("buildEpkBiddingStrategy — avg_cpa (AVERAGE_CPA)", () => {
  it("carries AverageCpa, GoalId and WeeklySpendLimit on Search", () => {
    const result = buildEpkBiddingStrategy({
      type: "avg_cpa",
      avg_cpa_micros: 5000000,
      goal_id: 100,
      weekly_budget_micros: 70000000,
    });
    expect(result.Search).toEqual({
      BiddingStrategyType: "AVERAGE_CPA",
      AverageCpa: { AverageCpa: 5000000, GoalId: 100, WeeklySpendLimit: 70000000 },
    });
    expect(result.Network).toEqual({ ...NETWORK_DEFAULT });
  });
});

describe("buildEpkBiddingStrategy — max_conversions (WB_MAXIMUM_CONVERSION_RATE)", () => {
  it("includes GoalId when goal_id is supplied", () => {
    const result = buildEpkBiddingStrategy({
      type: "max_conversions",
      weekly_budget_micros: 70000000,
      goal_id: 100,
    });
    const search = result.Search as Record<string, unknown>;
    expect(search.BiddingStrategyType).toBe("WB_MAXIMUM_CONVERSION_RATE");
    expect(search.WbMaximumConversionRate).toEqual({ WeeklySpendLimit: 70000000, GoalId: 100 });
  });

  it("omits GoalId when goal_id is absent (optional here)", () => {
    const result = buildEpkBiddingStrategy({
      type: "max_conversions",
      weekly_budget_micros: 70000000,
    });
    const search = result.Search as Record<string, unknown>;
    expect(search.WbMaximumConversionRate).toEqual({ WeeklySpendLimit: 70000000 });
  });
});

describe("buildEpkBiddingStrategy — pay_for_conversion (PAY_FOR_CONVERSION)", () => {
  it("carries Cpa + GoalId under PayForConversion", () => {
    const result = buildEpkBiddingStrategy({
      type: "pay_for_conversion",
      cpa_micros: 5000000,
      goal_id: 100,
    });
    const search = result.Search as Record<string, unknown>;
    expect(search.BiddingStrategyType).toBe("PAY_FOR_CONVERSION");
    expect(search.PayForConversion).toEqual({ Cpa: 5000000, GoalId: 100 });
  });
});

describe("buildEpkBiddingStrategy — required-field validation", () => {
  it("avg_cpa without goal_id throws", () => {
    expect(() =>
      buildEpkBiddingStrategy({ type: "avg_cpa", avg_cpa_micros: 5000000 }),
    ).toThrow();
  });

  it("avg_cpa without avg_cpa_micros throws", () => {
    expect(() => buildEpkBiddingStrategy({ type: "avg_cpa", goal_id: 100 })).toThrow();
  });

  it("pay_for_conversion without cpa_micros throws", () => {
    expect(() =>
      buildEpkBiddingStrategy({ type: "pay_for_conversion", goal_id: 100 }),
    ).toThrow();
  });

  it("pay_for_conversion without goal_id throws", () => {
    expect(() =>
      buildEpkBiddingStrategy({ type: "pay_for_conversion", cpa_micros: 5000000 }),
    ).toThrow();
  });

  it("max_clicks without weekly_budget_micros throws", () => {
    expect(() => buildEpkBiddingStrategy({ type: "max_clicks" })).toThrow();
  });

  it("avg_cpc without avg_cpc_micros throws", () => {
    expect(() => buildEpkBiddingStrategy({ type: "avg_cpc" })).toThrow();
  });
});

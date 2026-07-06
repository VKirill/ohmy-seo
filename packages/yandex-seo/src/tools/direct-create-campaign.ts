import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { buildUnifiedCampaignPayload, buildEpkBiddingStrategy } from "../lib/payload-builder.js";
import { strategySpecSchema } from "../lib/strategy-schema.js";
import { z } from "zod";

// Creates a Единая перформанс-кампания (ЕПК / UnifiedCampaign) — the only campaign
// type that serves combinatorial RESPONSIVE_AD on search. Posted to /json/v501/.
// Classic TEXT_CAMPAIGN (search/rsya splits) is retired for our combinatorial-only flow.
//
// Money is currency-agnostic: daily_budget_micros is the amount in the ACCOUNT
// currency × 1_000_000 (no RUB assumption). Read per-currency minimums from
// Dictionaries.get {Currencies} (USD MinimumDailyBudget = 10000000 = $10/day).
const InputSchema = z.object({
  name: z.string().min(1).describe("Campaign name"),
  daily_budget_micros: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Daily budget in ACCOUNT-currency micros (amount × 1_000_000). E.g. $10/day = 10000000. " +
        "Applied ONLY with a MANUAL search strategy (HIGHEST_POSITION); auto strategies carry WeeklySpendLimit " +
        "inside bidding_strategy instead. Must be ≥ the currency's MinimumDailyBudget from Dictionaries.get{Currencies}.",
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "start_date must be YYYY-MM-DD" })
    .optional()
    .describe("Campaign start date (ISO YYYY-MM-DD, default = today Moscow time)"),
  search_strategy: z
    .enum(["HIGHEST_POSITION", "WB_MAXIMUM_CLICKS", "WB_MAXIMUM_CONVERSION_RATE", "AVERAGE_CPC", "AVERAGE_CPA"])
    .default("HIGHEST_POSITION")
    .describe("Simple search bidding strategy (used only when bidding_strategy is omitted). Default HIGHEST_POSITION = manual."),
  strategy: strategySpecSchema.optional(),
  bidding_strategy: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Raw escape hatch — full BiddingStrategy verbatim: { Search: {...}, Network: {...} }. Prefer the typed `strategy` param. Use for weekly budgets, bid ceilings, " +
        "and enabling networks (РСЯ). Search+Network strategies must be COMPATIBLE (Yandex errors otherwise). " +
        "Auto strategies (WB_MAXIMUM_CLICKS, AVERAGE_CPC...) carry WeeklySpendLimit/BidCeiling in their own struct " +
        "and do NOT use daily_budget_micros. Network valid types: AVERAGE_CPC, AVERAGE_CPA, PAY_FOR_CONVERSION, " +
        "WB_MAXIMUM_CONVERSION_RATE (each needs its settings struct). SERVING_OFF = no network (search-only).",
    ),
  time_targeting: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Hourly display schedule (Campaign-level TimeTargeting). Shape: { Schedule: { Items: [\"<day>,<c0>,<c1>,...,<c23>\", ...] }, " +
        "ConsiderWorkingWeekends: \"YES\"|\"NO\" }. One item per weekday (1=Mon..7=Sun); each item is the day number + 24 hourly " +
        "bid coefficients (0–200, 100 = normal, 0 = don't show). ConsiderWorkingWeekends is required.",
    ),
  counter_ids: z.array(z.number()).optional().describe("Yandex Metrika counter IDs to attach (optional)"),
  goal_ids: z.array(z.number()).optional().describe("Metrika goal IDs → PriorityGoals (simple; Value defaults to 100). Use priority_goals for per-goal conversion value."),
  priority_goals: z
    .array(z.object({ goal_id: z.number().int().positive(), value: z.number().int().nonnegative().optional() }))
    .optional()
    .describe("Metrika goals with per-goal conversion Value (ценность конверсии, account-currency micros). Takes precedence over goal_ids. Goal must exist in a linked counter."),
  tracking_params: z.string().optional().describe("UTM / tracking params string (optional)"),
  confirm: z.boolean().describe("Must be true — confirms intent to create campaign"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type CampaignInput = z.infer<typeof InputSchema>;

export async function runDirectCreateCampaign(input: CampaignInput) {
  const parsed = InputSchema.parse(input);

  // Soft confirm gate — creation produces DRAFT only, no immediate money risk
  if (parsed.confirm !== true) {
    throw new Error("confirm: true required to create a campaign");
  }

  // Smoke-mode name prefix enforcement
  if (process.env.PHASE_3_5_B_SMOKE_MODE === "true") {
    if (!parsed.name.startsWith("phase-3-5-b-test_")) {
      throw new Error(
        "PHASE_3_5_B_SMOKE_MODE is enabled: campaign name must start with 'phase-3-5-b-test_'",
      );
    }
  }

  try {
    // Typed `strategy` (if given) builds a live-compatible { Search, Network } and wins over raw bidding_strategy.
    const biddingStrategy = parsed.strategy ? buildEpkBiddingStrategy(parsed.strategy) : parsed.bidding_strategy;

    const payload = buildUnifiedCampaignPayload({
      name: parsed.name,
      daily_budget_micros: parsed.daily_budget_micros,
      search_strategy_type: parsed.search_strategy,
      bidding_strategy: biddingStrategy,
      time_targeting: parsed.time_targeting,
      start_date: parsed.start_date,
      counter_ids: parsed.counter_ids,
      goal_ids: parsed.goal_ids,
      priority_goals: parsed.priority_goals,
      tracking_params: parsed.tracking_params,
    });

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/campaigns", // ЕПК is v501-only
      method: "POST",
      body: payload,
      account: parsed.account,
      client_login: parsed.client_login,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Yandex Direct API error", details: result.body }),
          },
        ],
      };
    }

    const data = result.data as Record<string, unknown>;
    const apiResult = (data?.result as Record<string, unknown>) ?? {};
    const addResults = apiResult.AddResults as Array<Record<string, unknown>> | undefined;
    const first = addResults?.[0];
    const campaignId = first?.Id as number | string | undefined;
    const errors = first?.Errors as unknown[] | undefined;

    if (errors && errors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Campaign creation failed", errors }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              campaign_id: campaignId != null ? String(campaignId) : null,
              name: parsed.name,
              type: "UNIFIED_CAMPAIGN",
              daily_budget_micros: parsed.daily_budget_micros,
              search_strategy: parsed.search_strategy,
              status: "DRAFT",
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

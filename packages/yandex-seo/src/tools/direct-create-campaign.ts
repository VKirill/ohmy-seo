import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const MICROS = 1_000_000;

const InputSchema = z.object({
  type: z.enum(["search", "rsya", "rsya-only"]).describe("Campaign type: search, rsya (both networks), or rsya-only"),
  name: z.string().min(1).describe("Campaign name"),
  daily_budget_rub: z.number().min(100).default(100).describe("Daily budget in RUB (min 100 — Direct minimum)"),
  region_ids: z.array(z.number()).default([213]).describe("Region IDs (default [213] = Moscow)"),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "start_date must be YYYY-MM-DD" })
    .default(() => new Date().toISOString().slice(0, 10))
    .describe("Campaign start date (ISO YYYY-MM-DD, default today)"),
  strategy: z
    .enum(["WB_DAILY_BUDGET", "AVERAGE_CPC", "AVERAGE_CPA", "AVERAGE_ROI", "WEEKLY_CLICK_PACKAGE", "MANUAL_CPM"])
    .default("WB_DAILY_BUDGET")
    .describe("Bidding strategy (default WB_DAILY_BUDGET)"),
  counter_ids: z.array(z.number()).optional().describe("Yandex Metrika counter IDs to attach (optional)"),
  confirm: z.boolean().describe("Must be true — confirms intent to create campaign"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
});

type CampaignInput = z.infer<typeof InputSchema>;

function buildDailyBudgetBlock(budgetRub: number): Record<string, unknown> {
  return {
    Amount: budgetRub * MICROS,
    Mode: "STANDARD",
  };
}

function buildBiddingStrategy(input: CampaignInput): Record<string, unknown> {
  const dailyBudget = buildDailyBudgetBlock(input.daily_budget_rub);

  if (input.type === "search") {
    return {
      Search: {
        BiddingStrategyType: "WB_DAILY_BUDGET",
        WbDailyBudget: {
          DailyBudget: dailyBudget,
        },
      },
      Network: {
        BiddingStrategyType: "SERVING_OFF",
      },
    };
  }

  if (input.type === "rsya") {
    return {
      Search: {
        BiddingStrategyType: "SERVING_OFF",
      },
      Network: {
        BiddingStrategyType: "WB_DAILY_BUDGET",
        WbDailyBudget: {
          DailyBudget: dailyBudget,
        },
      },
    };
  }

  // rsya-only: no search serving, network only
  return {
    Search: {
      BiddingStrategyType: "SERVING_OFF",
    },
    Network: {
      BiddingStrategyType: "WB_DAILY_BUDGET",
      WbDailyBudget: {
        DailyBudget: dailyBudget,
      },
    },
  };
}

function buildCampaignPayload(input: CampaignInput): Record<string, unknown> {
  const biddingStrategy = buildBiddingStrategy(input);

  const textCampaign: Record<string, unknown> = {
    BiddingStrategy: biddingStrategy,
    Settings: [{ Option: "ADD_METRICA_TAG", Value: "YES" }],
  };

  if (input.counter_ids && input.counter_ids.length > 0) {
    textCampaign.CounterIds = { Items: input.counter_ids };
  }

  const campaign: Record<string, unknown> = {
    Name: input.name,
    StartDate: input.start_date,
    TextCampaign: textCampaign,
  };

  if (input.region_ids && input.region_ids.length > 0) {
    campaign.RegionIds = input.region_ids;
  }

  return campaign;
}

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
        "PHASE_3_5_B_SMOKE_MODE is enabled: campaign name must start with 'phase-3-5-b-test_'"
      );
    }
  }

  try {
    const campaignPayload = buildCampaignPayload(parsed);

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "add",
        params: {
          Campaigns: [campaignPayload],
        },
      },
      account: parsed.account,
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
    const campaignId = first?.Id as number | undefined;
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
              campaign_id: campaignId ?? null,
              name: parsed.name,
              type: parsed.type,
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

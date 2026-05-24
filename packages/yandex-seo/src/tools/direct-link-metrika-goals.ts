import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  campaign_id: z.number().int().positive().describe("Yandex Direct campaign ID to link Metrika goals to"),
  counter_ids: z.array(z.number().int().positive()).min(1).describe("Yandex Metrika counter IDs, e.g. [54918634]"),
  goal_ids: z.array(z.number().int().positive()).min(1).describe("Metrika goal IDs to link, e.g. [254644847]"),
  strategy_type: z
    .enum(["WB_DAILY_BUDGET", "AVERAGE_CPA", "AVERAGE_ROI", "PAY_FOR_CONVERSION"])
    .describe("Current campaign bidding strategy — determines which Direct fields are updated"),
  priority: z
    .enum(["LOW", "NORMAL", "HIGH"])
    .default("NORMAL")
    .describe("Goal priority for WB_DAILY_BUDGET PriorityGoals (default NORMAL)"),
  confirm: z.boolean().describe("Must be true — confirms intent to modify the campaign"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
});

type LinkInput = z.infer<typeof InputSchema>;

const PRIORITY_VALUES: Record<string, number> = {
  LOW: 1,
  NORMAL: 100,
  HIGH: 1000,
};

async function verifyGoalsInMetrika(
  counter_ids: number[],
  goal_ids: number[],
  account: string | undefined,
): Promise<void> {
  for (const counter_id of counter_ids) {
    const result = await executeApiCall({
      apiName: "metrika",
      endpoint: `/management/v1/counter/${counter_id}/goals`,
      method: "GET",
      account,
    });

    if (!result.ok) {
      throw new Error(
        `Failed to fetch goals from Metrika counter ${counter_id}: HTTP ${result.status}`,
      );
    }

    const data = result.data as Record<string, unknown>;
    const goals = data?.goals as Array<{ id: number }> | undefined;
    if (!goals) {
      throw new Error(
        `Metrika counter ${counter_id} returned no 'goals' field in response`,
      );
    }

    const availableIds = goals.map((g) => g.id);
    for (const goal_id of goal_ids) {
      if (!availableIds.includes(goal_id)) {
        throw new Error(
          `Goal ${goal_id} not found in Metrika counter ${counter_id}. Available: ${availableIds.join(", ")}`,
        );
      }
    }
  }
}

function buildCampaignsUpdateParams(input: LinkInput): Record<string, unknown> {
  const params: { Campaigns: Array<Record<string, unknown>> } = {
    Campaigns: [{ Id: input.campaign_id, TextCampaign: {} as Record<string, unknown> }],
  };
  const campaign = params.Campaigns[0];
  const textCampaign = campaign.TextCampaign as Record<string, unknown>;

  if (input.strategy_type === "WB_DAILY_BUDGET") {
    textCampaign.CounterIds = { Items: input.counter_ids };
    const priorityValue = PRIORITY_VALUES[input.priority] ?? 100;
    textCampaign.PriorityGoals = {
      Items: input.goal_ids.map((gid) => ({ GoalId: gid, Value: priorityValue })),
    };
  } else if (
    input.strategy_type === "AVERAGE_CPA" ||
    input.strategy_type === "AVERAGE_ROI" ||
    input.strategy_type === "PAY_FOR_CONVERSION"
  ) {
    textCampaign.CounterIds = { Items: input.counter_ids };

    let strategyKey: string;
    if (input.strategy_type === "AVERAGE_CPA") {
      strategyKey = "AverageCpa";
    } else if (input.strategy_type === "AVERAGE_ROI") {
      strategyKey = "AverageCpaPerCamp";
    } else {
      strategyKey = "PayForConversion";
    }

    textCampaign.BiddingStrategy = {
      Search: {
        BiddingStrategyType: input.strategy_type,
        [strategyKey]: { GoalId: input.goal_ids[0] },
      },
      Network: { BiddingStrategyType: "SERVING_OFF" },
    };
  } else {
    throw new Error(
      "Unsupported strategy_type. Supported: WB_DAILY_BUDGET | AVERAGE_CPA | AVERAGE_ROI | PAY_FOR_CONVERSION",
    );
  }

  return params;
}

export async function runDirectLinkMetrikaGoals(input: LinkInput) {
  const parsed = InputSchema.parse(input);

  if (parsed.confirm !== true) {
    throw new Error("confirm: true required to link Metrika goals to a campaign");
  }

  try {
    // Step 1: Pre-check goals exist in Metrika
    await verifyGoalsInMetrika(parsed.counter_ids, parsed.goal_ids, parsed.account);

    // Step 2: Build and send Campaigns.update
    const updateParams = buildCampaignsUpdateParams(parsed);

    const updateResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "update",
        params: updateParams,
      },
      account: parsed.account,
    });

    if (!updateResult.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Yandex Direct Campaigns.update failed",
              details: updateResult.body,
            }),
          },
        ],
      };
    }

    const updateData = updateResult.data as Record<string, unknown>;
    const updateApiResult = (updateData?.result as Record<string, unknown>) ?? {};
    const updateResults = updateApiResult.UpdateResults as Array<Record<string, unknown>> | undefined;
    const firstUpdate = updateResults?.[0];
    const updateErrors = firstUpdate?.Errors as unknown[] | undefined;

    if (updateErrors && updateErrors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Campaign update returned errors",
              errors: updateErrors,
            }),
          },
        ],
      };
    }

    // Step 3: Verify persistence — fetch campaign to confirm
    const warnings: string[] = [];
    let persistedInDirect = false;

    const getResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { Ids: [parsed.campaign_id] },
          FieldNames: ["Id", "Name"],
          TextCampaignFieldNames: ["CounterIds", "PriorityGoals"],
        },
      },
      account: parsed.account,
    });

    if (!getResult.ok) {
      warnings.push(`Could not verify persistence — Campaigns.get returned HTTP ${getResult.status}`);
    } else {
      const getData = getResult.data as Record<string, unknown>;
      const getApiResult = (getData?.result as Record<string, unknown>) ?? {};
      const campaigns = getApiResult.Campaigns as Array<Record<string, unknown>> | undefined;
      const fetchedCampaign = campaigns?.[0];
      const textCampaignFields = fetchedCampaign?.TextCampaign as Record<string, unknown> | undefined;

      const returnedCounterIds =
        (textCampaignFields?.CounterIds as { Items?: number[] } | undefined)?.Items ?? [];
      const returnedGoalIds =
        (
          (textCampaignFields?.PriorityGoals as { Items?: Array<{ GoalId: number }> } | undefined)
            ?.Items ?? []
        ).map((g) => g.GoalId);

      const countersMatch = parsed.counter_ids.every((id) => returnedCounterIds.includes(id));
      const goalsMatch =
        parsed.strategy_type === "WB_DAILY_BUDGET"
          ? parsed.goal_ids.every((id) => returnedGoalIds.includes(id))
          : true; // For strategy-based goals they live in BiddingStrategy, not PriorityGoals

      persistedInDirect = countersMatch && goalsMatch;

      if (!countersMatch) {
        warnings.push(
          `Counter IDs mismatch after update — expected ${JSON.stringify(parsed.counter_ids)}, got ${JSON.stringify(returnedCounterIds)}`,
        );
      }
      if (parsed.strategy_type === "WB_DAILY_BUDGET" && !goalsMatch) {
        warnings.push(
          `Goal IDs mismatch after update — expected ${JSON.stringify(parsed.goal_ids)}, got ${JSON.stringify(returnedGoalIds)}`,
        );
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              campaign_id: parsed.campaign_id,
              linked_counter_ids: parsed.counter_ids,
              linked_goal_ids: parsed.goal_ids,
              strategy_type: parsed.strategy_type,
              persisted_in_direct: persistedInDirect,
              warnings,
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

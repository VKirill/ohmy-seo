import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { z } from "zod";

const MICROS = 1_000_000;

const InputSchema = z.object({
  campaign_ids: z.array(z.number().int().positive()).min(1).describe("Campaign IDs to update daily budget for (required, at least 1)"),
  daily_budget_rub: z.number().min(100).describe("New daily budget in RUB (minimum 100 — Direct platform minimum)"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  acknowledge_live: z.string().describe("Exact ack string: I-UNDERSTAND-BUDGET-LIVE:<account>:<sorted_ids_csv>:<budget_rub>"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
});

type UpdateBudgetsInput = z.infer<typeof InputSchema>;

export async function runDirectUpdateBudgets(input: UpdateBudgetsInput) {
  const parsed = InputSchema.parse(input);

  const accountLabel = parsed.account ?? "default";
  const sortedIds = [...parsed.campaign_ids].sort((a, b) => a - b).join(",");
  const expectedAck = `I-UNDERSTAND-BUDGET-LIVE:${accountLabel}:${sortedIds}:${parsed.daily_budget_rub}`;

  try {
    requireConfirmGate(parsed, { expectedAck });
  } catch (err) {
    if (err instanceof ConfirmGateError) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message, expected_ack: expectedAck }) }],
      };
    }
    throw err;
  }

  // NOTE: This assumes campaigns use WB_DAILY_BUDGET strategy on the Search network.
  // If a campaign uses a different bidding strategy, Yandex Direct will return an error
  // for that campaign — this is expected behavior and not silently swallowed.
  // Loop through campaign_ids (1 update per call to avoid batch strategy conflicts).
  const results: Array<{ campaign_id: number; ok: boolean; data?: unknown; error?: unknown }> = [];

  try {
    for (const campaignId of parsed.campaign_ids) {
      const result = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/campaigns",
        method: "POST",
        body: {
          method: "update",
          params: {
            Campaigns: [
              {
                Id: campaignId,
                TextCampaign: {
                  BiddingStrategy: {
                    Search: {
                      BiddingStrategyType: "WB_DAILY_BUDGET",
                      WbDailyBudget: {
                        DailyBudget: {
                          Amount: parsed.daily_budget_rub * MICROS,
                          Currency: "RUB",
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
        account: parsed.account,
      });

      if (!result.ok) {
        results.push({ campaign_id: campaignId, ok: false, error: result.body });
      } else {
        results.push({ campaign_id: campaignId, ok: true, data: result.data });
      }
    }

    const allOk = results.every((r) => r.ok);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            updated: allOk,
            daily_budget_rub: parsed.daily_budget_rub,
            results,
          }),
        },
      ],
    };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

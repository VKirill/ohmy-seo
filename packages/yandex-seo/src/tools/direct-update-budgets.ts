import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { z } from "zod";

// Currency-agnostic budget update for ЕПК (UnifiedCampaign). DailyBudget is a
// Campaign-level field updated via /json/v501/campaigns — no Currency sub-field
// (it follows the account currency), no TextCampaign/strategy nesting. Works for
// USD, RUB, EUR… alike. DailyBudget only applies to MANUAL-strategy campaigns;
// auto strategies carry WeeklySpendLimit inside their bidding strategy.
const InputSchema = z.object({
  campaign_ids: z.array(z.number().int().positive()).min(1).describe("Campaign IDs to update daily budget for (required, at least 1)"),
  daily_budget_micros: z
    .number()
    .int()
    .positive()
    .describe("New daily budget in ACCOUNT-currency micros (amount × 1_000_000). ≥ the currency's MinimumDailyBudget from Dictionaries.get{Currencies}."),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  acknowledge_live: z.string().describe("Exact ack string: I-UNDERSTAND-BUDGET-LIVE:<account>:<sorted_ids_csv>:<budget_micros>"),
  acknowledge_budget_threshold: z
    .string()
    .optional()
    .describe(
      "Only required when daily_budget_micros exceeds the configured ceiling " +
        "(env YANDEX_DIRECT_MAX_DAILY_BUDGET_MICROS, if set). Exact ack: " +
        "I-UNDERSTAND-BUDGET-EXCEEDS-THRESHOLD:<budget_micros>:<ceiling_micros>."
    ),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type UpdateBudgetsInput = z.infer<typeof InputSchema>;

export async function runDirectUpdateBudgets(input: UpdateBudgetsInput) {
  const parsed = InputSchema.parse(input);

  const accountLabel = parsed.account ?? "default";
  const sortedIds = [...parsed.campaign_ids].sort((a, b) => a - b).join(",");
  const expectedAck = `I-UNDERSTAND-BUDGET-LIVE:${accountLabel}:${sortedIds}:${parsed.daily_budget_micros}`;

  try {
    requireConfirmGate(parsed, {
      expectedAck,
      budgetCheck: {
        amountMicros: parsed.daily_budget_micros,
        ceilingEnvVar: "YANDEX_DIRECT_MAX_DAILY_BUDGET_MICROS",
        label: "BUDGET",
      },
    });
  } catch (err) {
    if (err instanceof ConfirmGateError) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message, expected_ack: expectedAck }) }],
      };
    }
    throw err;
  }

  const results: Array<{ campaign_id: number; ok: boolean; data?: unknown; error?: unknown }> = [];

  try {
    for (const campaignId of parsed.campaign_ids) {
      const result = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v501/campaigns", // ЕПК campaign updates are v501
        method: "POST",
        body: {
          method: "update",
          params: {
            Campaigns: [
              {
                Id: campaignId,
                // Campaign-level DailyBudget — no Currency (follows account), no strategy nesting.
                DailyBudget: { Amount: parsed.daily_budget_micros, Mode: "STANDARD" },
              },
            ],
          },
        },
        account: parsed.account,
        client_login: parsed.client_login,
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
            daily_budget_micros: parsed.daily_budget_micros,
            results,
          }),
        },
      ],
    };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

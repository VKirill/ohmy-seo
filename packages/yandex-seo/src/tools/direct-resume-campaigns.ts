import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { z } from "zod";

const InputSchema = z.object({
  campaign_ids: z.array(z.number().int().positive()).min(1).describe("Campaign IDs to resume (required, at least 1)"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  acknowledge_live: z.string().describe("Exact ack string: I-UNDERSTAND-RESUME-LIVE:<account>:<sorted_ids_csv>"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().optional().describe("Yandex Direct agency client login for sub-client access (optional)"),
});

type ResumeCampaignsInput = z.infer<typeof InputSchema>;

export async function runDirectResumeCampaigns(input: ResumeCampaignsInput) {
  const parsed = InputSchema.parse(input);

  const accountLabel = parsed.account ?? "default";
  const sortedIds = [...parsed.campaign_ids].sort((a, b) => a - b).join(",");
  const expectedAck = `I-UNDERSTAND-RESUME-LIVE:${accountLabel}:${sortedIds}`;

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

  try {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/campaigns",
      method: "POST",
      body: {
        method: "resume",
        params: { SelectionCriteria: { Ids: parsed.campaign_ids } },
      },
      account: parsed.account,
      client_login: parsed.client_login,
    });

    if (!result.ok) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Yandex Direct Campaigns.resume failed", details: result.body }) }],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            resumed: true,
            campaign_ids: parsed.campaign_ids,
            result: result.data,
          }),
        },
      ],
    };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

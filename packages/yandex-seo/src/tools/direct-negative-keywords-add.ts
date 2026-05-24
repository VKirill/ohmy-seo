import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
// requireConfirmGate is imported for typing/consistency — this tool uses a DANGER-lite manual gate
// (no acknowledge_live ack check, since minus-words are lower-risk than pause/delete/budget changes).
import { requireConfirmGate } from "../lib/api/confirm-gate.js"; // eslint-disable-line @typescript-eslint/no-unused-vars
import { z } from "zod";

const InputSchema = z.object({
  target: z
    .union([
      z.object({ campaign_id: z.number().int().positive() }),
      z.object({ ad_group_id: z.number().int().positive() }),
    ])
    .describe("Target: either { campaign_id } or { ad_group_id } — mutually exclusive"),
  keywords: z.array(z.string().min(1)).min(1).describe("Negative keywords to add (minus-words), e.g. ['бесплатно', 'своими руками']"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
});

type NegativeKeywordsInput = z.infer<typeof InputSchema>;

export async function runDirectNegativeKeywordsAdd(input: NegativeKeywordsInput) {
  const parsed = InputSchema.parse(input);

  // DANGER-lite gate: env flags + confirm, but no acknowledge_live ack (minus-words are lower-risk)
  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new Error("OHMY_SEO_ALLOW_LIVE_MUTATIONS=true required");
  }
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new Error("YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true required");
  }
  if (parsed.confirm !== true) {
    throw new Error("confirm: true required");
  }

  try {
    if ("campaign_id" in parsed.target) {
      // Campaign-level negative keywords
      const result = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/campaigns",
        method: "POST",
        body: {
          method: "update",
          params: {
            Campaigns: [
              {
                Id: parsed.target.campaign_id,
                NegativeKeywordSharedSetIds: { Items: [] },
                NegativeKeywords: { Items: parsed.keywords },
              },
            ],
          },
        },
        account: parsed.account,
      });

      if (!result.ok) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Yandex Direct Campaigns.update (negative keywords) failed", details: result.body }) },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              added: true,
              level: "campaign",
              campaign_id: parsed.target.campaign_id,
              keywords: parsed.keywords,
              result: result.data,
            }),
          },
        ],
      };
    } else {
      // Ad group-level negative keywords
      const result = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/adgroups",
        method: "POST",
        body: {
          method: "update",
          params: {
            AdGroups: [
              {
                Id: parsed.target.ad_group_id,
                NegativeKeywords: { Items: parsed.keywords },
              },
            ],
          },
        },
        account: parsed.account,
      });

      if (!result.ok) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Yandex Direct AdGroups.update (negative keywords) failed", details: result.body }) },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              added: true,
              level: "ad_group",
              ad_group_id: parsed.target.ad_group_id,
              keywords: parsed.keywords,
              result: result.data,
            }),
          },
        ],
      };
    }
  } catch (err) {
    return errorToMcpContent(err);
  }
}

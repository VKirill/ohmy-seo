import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  ad_group_ids: z.array(z.number()).min(1),
  campaign_ids: z.array(z.number()).optional(),
  states: z.array(z.enum(["ON", "OFF", "SUSPENDED", "ARCHIVED"])).optional(),
  statuses: z.array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"])).optional(),
  ids: z.array(z.number()).optional(),
  keyword_text: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(10000).default(100),
  account: z.string().optional(),
});

export async function runDirectListKeywords(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);
  const selectionCriteria: Record<string, unknown> = {
    AdGroupIds: parsed.ad_group_ids,
  };
  if (parsed.campaign_ids) selectionCriteria.CampaignIds = parsed.campaign_ids;
  if (parsed.states) selectionCriteria.States = parsed.states;
  if (parsed.statuses) selectionCriteria.Statuses = parsed.statuses;
  if (parsed.ids) selectionCriteria.Ids = parsed.ids;
  if (parsed.keyword_text) selectionCriteria.KeywordTexts = parsed.keyword_text;

  try {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      body: {
        method: "get",
        params: {
          SelectionCriteria: selectionCriteria,
          FieldNames: ["Id", "AdGroupId", "CampaignId", "Keyword", "State", "Status", "ServingStatus"],
          Page: { Limit: parsed.limit },
        },
      },
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

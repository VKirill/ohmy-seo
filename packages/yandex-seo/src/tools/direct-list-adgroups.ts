import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  campaign_ids: z.array(z.number()).min(1),
  states: z.array(z.enum(["ON", "OFF", "SUSPENDED", "ENDED", "CONVERTED", "ARCHIVED"])).optional(),
  types: z.array(z.string()).optional(),
  statuses: z.array(z.enum(["DRAFT", "MODERATION", "ACCEPTED", "REJECTED"])).optional(),
  ids: z.array(z.number()).optional(),
  limit: z.number().int().positive().max(10000).default(100),
  account: z.string().optional(),
});

export async function runDirectListAdGroups(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);
  const selectionCriteria: Record<string, unknown> = {
    CampaignIds: parsed.campaign_ids,
  };
  if (parsed.states) selectionCriteria.States = parsed.states;
  if (parsed.types) selectionCriteria.Types = parsed.types;
  if (parsed.statuses) selectionCriteria.Statuses = parsed.statuses;
  if (parsed.ids) selectionCriteria.Ids = parsed.ids;

  try {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adgroups",
      body: {
        method: "get",
        params: {
          SelectionCriteria: selectionCriteria,
          FieldNames: ["Id", "Name", "CampaignId", "Status", "Type", "RegionIds"],
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

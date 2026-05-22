import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  mode: z.enum(["check", "checkDictionaries"]).default("check"),
  since_timestamp: z.string().optional(),
  campaign_ids: z.array(z.number()).optional(),
  ad_group_ids: z.array(z.number()).optional(),
  ad_ids: z.array(z.number()).optional(),
  field_names: z.array(z.string()).optional(),
  account: z.string().optional(),
});

export async function runDirectGetChangeHistory(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);

  if (parsed.mode === "check" && !parsed.since_timestamp) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "Validation error: since_timestamp is required when mode is 'check'. Provide an ISO 8601 timestamp (e.g. '2024-01-01T00:00:00Z') to check for changes since that point in time. If you do not have a timestamp, call with mode='checkDictionaries' first to get dictionary versions.",
          }),
        },
      ],
    };
  }

  let body: Record<string, unknown>;

  if (parsed.mode === "checkDictionaries") {
    body = { method: "checkDictionaries" };
  } else {
    const params: Record<string, unknown> = {
      Timestamp: parsed.since_timestamp,
    };
    if (parsed.campaign_ids) params.CampaignIds = parsed.campaign_ids;
    if (parsed.ad_group_ids) params.AdGroupIds = parsed.ad_group_ids;
    if (parsed.ad_ids) params.AdIds = parsed.ad_ids;
    if (parsed.field_names) params.FieldNames = parsed.field_names;

    body = { method: "check", params };
  }

  try {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/changes",
      body,
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

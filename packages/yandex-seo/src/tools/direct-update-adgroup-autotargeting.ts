import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildAutoTargetingUpdatePayload } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  ad_group_id: z.number().int(),
  group_type: z.enum(["TEXT_AD_GROUP", "UNIFIED_AD_GROUP", "MOBILE_APP_AD_GROUP"]),
  categories: z.array(z.object({
    Category: z.enum(["TARGET_QUERIES", "ALTERNATIVE_QUERIES", "COMPETITOR_QUERIES", "ACCESSORY_QUERIES", "BROAD_MATCH", "EXACT_MENTION"]),
    Value: z.enum(["YES", "NO"]),
  })),
  confirm: z.boolean(),
  account: z.string().optional(),
});

export async function runDirectUpdateAdgroupAutotargeting(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);
    if (parsed.confirm !== true) throw new Error("confirm: true required");

    const body = buildAutoTargetingUpdatePayload({
      ad_group_id: parsed.ad_group_id,
      group_type: parsed.group_type,
      categories: parsed.categories,
    });
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adgroups",
      body,
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

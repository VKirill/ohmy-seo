import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildAutoTargetingUpdatePayload, mapAutotargetingCategoryName } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  ad_group_id: z.number().int(),
  categories: z.array(z.object({
    Category: z.string(),
    Value: z.enum(["YES", "NO"]),
  })),
  confirm: z.boolean(),
  account: z.string().optional(),
});

export async function runDirectUpdateAdgroupAutotargeting(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);
    if (parsed.confirm !== true) throw new Error("confirm: true required");

    // Map legacy names to API names; drop unmappable (TARGET_QUERIES etc.)
    const categories = parsed.categories
      .map((c) => {
        const apiName = mapAutotargetingCategoryName(c.Category);
        return apiName ? { Category: apiName, Value: c.Value } : null;
      })
      .filter((c): c is { Category: string; Value: "YES" | "NO" } => c !== null);

    // GET keywords for this ad group to find the ---autotargeting keyword
    const kwGetResult = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { AdGroupIds: [parsed.ad_group_id] },
          FieldNames: ["Id", "Keyword"],
        },
      },
      account: parsed.account,
    });

    if (!kwGetResult.ok) {
      throw new Error(`keywords.get failed: ${JSON.stringify(kwGetResult.body)}`);
    }

    const kwItems = (kwGetResult.data as { result?: { Keywords?: Array<{ Id: number; Keyword: string }> } })
      ?.result?.Keywords ?? [];
    const atKw = kwItems.find((k) => k.Keyword === "---autotargeting");

    if (!atKw) {
      throw new Error(`---autotargeting keyword not found for ad_group_id=${parsed.ad_group_id}`);
    }

    const body = buildAutoTargetingUpdatePayload({
      autotargeting_keyword_id: atKw.Id,
      categories,
    });

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/keywords",
      body,
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildSitelinksSetPayload } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  sitelinks: z.array(z.object({
    Title: z.string().min(1).max(30),
    Description: z.string().max(60).optional(),
    Href: z.string(),
  })).min(1).max(8),
  confirm: z.boolean(),
  account: z.string().optional(),
});

export async function runDirectCreateSitelinksSet(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);
    if (parsed.confirm !== true) throw new Error("confirm: true required");

    const body = buildSitelinksSetPayload({ Sitelinks: parsed.sitelinks });
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/sitelinks",
      body,
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

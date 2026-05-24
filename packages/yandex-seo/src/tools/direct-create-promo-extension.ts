import { z } from "zod";
import { executeApiCall } from "../lib/api-gateway.js";
import { buildPromoExtensionPayload } from "../lib/payload-builder.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const InputSchema = z.object({
  promo: z.object({
    PromotionType: z.enum(["DISCOUNT", "BONUS", "FREE_DELIVERY", "SALE", "EVENT", "BUNDLE"]),
    Discount: z.number().optional(),
    DiscountUnit: z.enum(["PERCENT", "RUB", "USD", "EUR"]).optional(),
    StartDate: z.string().optional(),
    EndDate: z.string(),
    PromoCode: z.string().optional(),
    Href: z.string().optional(),
  }),
  confirm: z.boolean(),
  account: z.string().optional(),
});

export async function runDirectCreatePromoExtension(input: z.infer<typeof InputSchema>) {
  try {
    const parsed = InputSchema.parse(input);
    if (parsed.confirm !== true) throw new Error("confirm: true required");

    const body = buildPromoExtensionPayload({ PromoExtension: parsed.promo });
    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/adextensions",
      body,
      account: parsed.account,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

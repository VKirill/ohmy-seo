import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { buildResponsiveAdPayload } from "../lib/payload-builder.js";
import { z } from "zod";

// Combinatorial ad (ЕПК RESPONSIVE_AD). One ad carries a POOL of 1–7 titles and
// 1–3 texts; Yandex assembles the best combination. Created on /json/v501/ads —
// v5 returns error 3500. Classic single-title TextAd / РСЯ TextImageAd are retired.
const InputSchema = z.object({
  ad_group_id: z.number().int().positive().describe("Parent ad group ID (must belong to a UNIFIED_CAMPAIGN / ЕПК)"),
  titles: z
    .array(z.string().min(1).max(56))
    .min(1)
    .max(7)
    .describe("Headline pool: 1–7 titles, each ≤56 chars (each word ≤22). Yandex combines them."),
  texts: z
    .array(z.string().min(1).max(81))
    .min(1)
    .max(3)
    .describe("Text pool: 1–3 texts, each ≤81 chars (each word ≤23)."),
  href: z.string().min(1).max(1024).describe("Target URL (single Href)"),
  image_hashes: z
    .array(z.string().min(1))
    .max(5)
    .optional()
    .describe("1–5 AdImageHashes from direct_upload_image (optional; text-only combinatorial ads are allowed)"),
  sitelinks_set_id: z.number().int().positive().optional().describe("Sitelinks set ID (optional)"),
  ad_extensions: z
    .array(z.number().int().positive())
    .max(50)
    .optional()
    .describe("Callout extension IDs (≤50, optional)"),
  video_extension_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(6)
    .optional()
    .describe("1–6 VideoExtension IDs (optional)"),
  business_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Yandex.Business organization ID to attach to the ad (optional)"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required to create an ad"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type AdUnifiedInput = z.infer<typeof InputSchema>;

export async function runDirectCreateAdUnified(input: AdUnifiedInput) {
  const parsed = InputSchema.parse(input);

  if (parsed.confirm !== true) {
    throw new Error("confirm: true required");
  }

  try {
    const payload = buildResponsiveAdPayload({
      ad_group_id: parsed.ad_group_id,
      Titles: parsed.titles,
      Texts: parsed.texts,
      Href: parsed.href,
      AdImageHashes: parsed.image_hashes,
      VideoExtensionIds: parsed.video_extension_ids,
      SitelinkSetId: parsed.sitelinks_set_id,
      AdExtensionIds: parsed.ad_extensions,
      BusinessId: parsed.business_id,
    });

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/ads", // combinatorial RESPONSIVE_AD is v501-only
      method: "POST",
      body: payload,
      account: parsed.account,
      client_login: parsed.client_login,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Yandex Direct API error", details: result.body }),
          },
        ],
      };
    }

    const data = result.data as Record<string, unknown>;
    const apiResult = (data?.result as Record<string, unknown>) ?? {};
    const addResults = apiResult.AddResults as Array<Record<string, unknown>> | undefined;
    const first = addResults?.[0];
    // Ad Ids exceed 2^53 — parseJsonSafe keeps them as exact strings. Never cast to number.
    const adId = first?.Id as string | number | undefined;
    const errors = first?.Errors as unknown[] | undefined;

    if (errors && errors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Ad creation failed", errors }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ad_id: adId != null ? String(adId) : null,
              ad_group_id: parsed.ad_group_id,
              titles: parsed.titles.length,
              texts: parsed.texts.length,
              images: parsed.image_hashes?.length ?? 0,
              has_sitelinks: parsed.sitelinks_set_id !== undefined,
              type: "RESPONSIVE_AD",
              status: "DRAFT",
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

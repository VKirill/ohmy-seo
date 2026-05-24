import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  ad_group_id: z.number().int().positive().describe("Parent ad group ID"),
  title: z.string().min(1).max(56).describe("Main headline (≤56 chars including punctuation)"),
  title2: z.string().max(30).optional().describe("Secondary headline (≤30 chars, optional)"),
  text: z.string().min(1).max(81).describe("Ad text (≤81 chars including punctuation)"),
  href: z.string().min(1).describe("Target URL"),
  display_url_path: z.string().max(20).optional().describe("Display URL path (≤20 chars, optional)"),
  sitelinks_set_id: z.number().int().positive().optional().describe("Sitelinks set ID from Direct Sitelinks API (optional)"),
  vcard_id: z.number().int().positive().optional().describe("VCard ID (optional)"),
  ad_extensions: z.array(z.number().int().positive()).optional().describe("Callout extension IDs (optional)"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required to create an ad"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
});

type AdTgoInput = z.infer<typeof InputSchema>;

function buildAdPayload(input: AdTgoInput): Record<string, unknown> {
  const textAd: Record<string, unknown> = {
    Title: input.title,
    Text: input.text,
    Href: input.href,
    Mobile: "NO",
  };

  if (input.title2 !== undefined) {
    textAd.Title2 = input.title2;
  }
  if (input.display_url_path !== undefined) {
    textAd.DisplayUrlPath = input.display_url_path;
  }
  if (input.sitelinks_set_id !== undefined) {
    textAd.SitelinksSetId = input.sitelinks_set_id;
  }
  if (input.vcard_id !== undefined) {
    textAd.VCardId = input.vcard_id;
  }
  if (input.ad_extensions !== undefined && input.ad_extensions.length > 0) {
    textAd.AdExtensions = { Items: input.ad_extensions };
  }

  return {
    AdGroupId: input.ad_group_id,
    TextAd: textAd,
  };
}

export async function runDirectCreateAdTgo(input: AdTgoInput) {
  const parsed = InputSchema.parse(input);

  if (parsed.confirm !== true) {
    throw new Error("confirm: true required");
  }

  try {
    const adPayload = buildAdPayload(parsed);

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/ads",
      method: "POST",
      body: {
        method: "add",
        params: {
          Ads: [adPayload],
        },
      },
      account: parsed.account,
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
    const adId = first?.Id as number | undefined;
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
              ad_id: adId ?? null,
              ad_group_id: parsed.ad_group_id,
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

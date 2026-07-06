import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

const InputSchema = z.object({
  campaign_id: z.number().int().positive().describe("Parent campaign ID"),
  name: z.string().min(1).describe("Ad group name"),
  region_ids: z.array(z.number()).default([213]).describe("Target region IDs (default [213] = Moscow)"),
  negative_keywords: z
    .object({ Items: z.array(z.string()) })
    .optional()
    .describe("Negative keywords list (optional)"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required to create an ad group"),
  account: z.string().min(1).optional().describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().min(1).optional().describe("Agency client login (Client-Login header) for sub-client cabinets"),
});

type AdGroupInput = z.infer<typeof InputSchema>;

function buildAdGroupPayload(input: AdGroupInput): Record<string, unknown> {
  const adGroup: Record<string, unknown> = {
    Name: input.name,
    CampaignId: input.campaign_id,
    RegionIds: input.region_ids,
  };

  if (input.negative_keywords) {
    adGroup.NegativeKeywords = input.negative_keywords;
  }

  return adGroup;
}

export async function runDirectCreateAdGroup(input: AdGroupInput) {
  const parsed = InputSchema.parse(input);

  if (parsed.confirm !== true) {
    throw new Error("confirm: true required to create an ad group");
  }

  try {
    const adGroupPayload = buildAdGroupPayload(parsed);

    const result = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v501/adgroups", // ЕПК ad groups live on v501; Type is inherited (never sent)
      method: "POST",
      body: {
        method: "add",
        params: {
          AdGroups: [adGroupPayload],
        },
      },
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
    const adGroupId = first?.Id as number | undefined;
    const errors = first?.Errors as unknown[] | undefined;

    if (errors && errors.length > 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "Ad group creation failed", errors }),
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
              ad_group_id: adGroupId ?? null,
              name: parsed.name,
              campaign_id: parsed.campaign_id,
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

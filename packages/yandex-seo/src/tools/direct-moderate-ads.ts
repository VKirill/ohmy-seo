import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { requireConfirmGate, ConfirmGateError } from "../lib/api/confirm-gate.js";
import { z } from "zod";

const InputSchema = z.object({
  campaign_ids: z.array(z.number().int().positive()).min(1)
    .describe("Campaign IDs whose DRAFT ads should be sent to moderation (required, at least 1)"),
  ad_ids: z.array(z.union([z.number().int().positive(), z.string().min(1)])).optional()
    .describe("Explicit Ad IDs to moderate (numbers, or exact-string Ids for big-int ad Ids > 2^53); when omitted, all DRAFT ads of the campaigns are fetched automatically"),
  confirm: z.boolean().describe("Must be true — explicit intent confirmation required"),
  acknowledge_live: z.string()
    .describe("Exact ack string: I-UNDERSTAND-MODERATE-LIVE:<account_or_default>:<sorted_campaign_ids_csv>"),
  account: z.string().min(1).optional()
    .describe("Account label from list_accounts (optional if a default account is configured)"),
  client_login: z.string().optional()
    .describe("Yandex Direct agency client login for sub-client access (optional)"),
});

type ModerateAdsInput = z.infer<typeof InputSchema>;

const MODERATE_CHUNK = 1000;

function topLevelApiError(data: Record<string, unknown> | undefined): string | undefined {
  const err = data?.["error"] as Record<string, unknown> | undefined;
  if (!err) return undefined;
  const detail = err["error_detail"];
  return `Direct API error ${String(err["error_code"])}: ${String(err["error_string"])}${detail ? ` — ${String(detail)}` : ""}`;
}

/** Fetch all DRAFT ad IDs for the given campaigns (paginated Ads.get). */
async function fetchDraftAdIds(
  campaign_ids: number[],
  account: string | undefined,
  client_login: string | undefined
): Promise<{ ids?: string[]; error?: string }> {
  // Ad Ids exceed 2^53 and arrive as exact strings (parseJsonSafe). Keep them as
  // strings — Yandex accepts string Ids on Ads.get/moderate/delete (verified live).
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const res = await executeApiCall({
      apiName: "direct",
      endpoint: "/json/v5/ads",
      method: "POST",
      body: {
        method: "get",
        params: {
          SelectionCriteria: { CampaignIds: campaign_ids, Statuses: ["DRAFT"] },
          FieldNames: ["Id"],
          Page: { Limit: 10000, Offset: offset },
        },
      },
      account,
      client_login,
    });
    if (!res.ok) return { error: "Ads.get failed: HTTP error" };
    const data = res.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
    const apiErr = topLevelApiError(data);
    if (apiErr) return { error: `Ads.get failed: ${apiErr}` };
    const result = data?.["result"] as Record<string, unknown> | undefined;
    const ads = (result?.["Ads"] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ad of ads) {
      const id = ad?.["Id"];
      if (typeof id === "number" || typeof id === "string") ids.push(String(id));
    }
    const limitedBy = result?.["LimitedBy"];
    if (typeof limitedBy !== "number") break;
    offset = limitedBy;
  }
  return { ids };
}

export async function runDirectModerateAds(input: ModerateAdsInput) {
  const parsed = InputSchema.parse(input);

  const accountLabel = parsed.account ?? "default";
  const sortedIds = [...parsed.campaign_ids].sort((a, b) => a - b).join(",");
  const expectedAck = `I-UNDERSTAND-MODERATE-LIVE:${accountLabel}:${sortedIds}`;

  try {
    requireConfirmGate(parsed, { expectedAck });
  } catch (err) {
    if (err instanceof ConfirmGateError) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: err.code, message: err.message, expected_ack: expectedAck }) }],
      };
    }
    throw err;
  }

  try {
    // Resolve target ad IDs: explicit list or all DRAFT ads of the campaigns.
    // Dedupe unconditionally — Ads.moderate rejects the whole request with
    // "Object appears more than once" when an ID repeats.
    let adIds: string[];
    if (parsed.ad_ids && parsed.ad_ids.length > 0) {
      adIds = [...new Set(parsed.ad_ids.map((x) => String(x)))];
    } else {
      const fetched = await fetchDraftAdIds(parsed.campaign_ids, parsed.account, parsed.client_login);
      if (fetched.error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: fetched.error }) }] };
      }
      adIds = [...new Set(fetched.ids ?? [])];
    }

    if (adIds.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ moderated: 0, message: "No DRAFT ads found for the given campaigns — nothing to moderate." }),
        }],
      };
    }

    let submitted = 0;
    const itemErrors: string[] = [];
    for (let i = 0; i < adIds.length; i += MODERATE_CHUNK) {
      const chunk = adIds.slice(i, i + MODERATE_CHUNK);
      const res = await executeApiCall({
        apiName: "direct",
        endpoint: "/json/v5/ads",
        method: "POST",
        body: { method: "moderate", params: { SelectionCriteria: { Ids: chunk } } },
        account: parsed.account,
        client_login: parsed.client_login,
      });
      if (!res.ok) {
        itemErrors.push(`chunk ${i / MODERATE_CHUNK + 1}: HTTP error`);
        continue;
      }
      const data = res.data as Record<string, unknown>; // guardian: allow — Direct API response is untyped JSON
      const apiErr = topLevelApiError(data);
      if (apiErr) {
        itemErrors.push(`chunk ${i / MODERATE_CHUNK + 1}: ${apiErr}`);
        continue;
      }
      const result = data?.["result"] as Record<string, unknown> | undefined;
      const moderateResults = (result?.["ModerateResults"] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const item of moderateResults) {
        const errs = item?.["Errors"] as Array<Record<string, unknown>> | undefined;
        if (errs && errs.length > 0) {
          const msg = errs.map((e) => e?.["Message"] ?? JSON.stringify(e)).join("; ");
          itemErrors.push(`ad ${String(item?.["Id"] ?? "?")}: ${msg}`);
        } else if (item?.["Id"] != null) {
          submitted += 1;
        }
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          moderated: submitted,
          total_candidates: adIds.length,
          campaign_ids: parsed.campaign_ids,
          errors: itemErrors,
          note: "Ads submitted to Yandex moderation. Campaign state (ON/OFF) is NOT changed by this tool — resuming a campaign is a separate owner decision.",
        }, null, 2),
      }],
    };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

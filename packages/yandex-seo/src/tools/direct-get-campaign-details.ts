import { executeApiCall } from "../lib/api-gateway.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { z } from "zod";

/**
 * Read campaign-level settings that no other read tool exposes: bidding strategy,
 * linked Metrika counters, optimisation goals (PriorityGoals) and attribution model.
 *
 * yandex_direct_list_campaigns deliberately returns a narrow field set, and the
 * generic yandex_direct_api gateway requires the caller to hand-build the payload —
 * which is exactly where clients that stringify `body` used to fail. This wrapper
 * builds the campaigns.get payload server-side, so it works from any client.
 */
const DEFAULT_FIELD_NAMES = [
  "Id",
  "Name",
  "Type",
  "Status",
  "State",
  "StartDate",
  "EndDate",
  "Currency",
  "DailyBudget",
  "TimeTargeting",
  "TimeZone",
  "ExcludedSites",
  "NegativeKeywords",
];

const DEFAULT_TYPED_FIELD_NAMES = [
  "BiddingStrategy",
  "Settings",
  "CounterIds",
  "PriorityGoals",
  "AttributionModel",
];

const InputSchema = z.object({
  ids: z.array(z.number()).optional(),
  states: z
    .array(z.enum(["ON", "OFF", "SUSPENDED", "ENDED", "CONVERTED", "ARCHIVED"]))
    .optional(),
  types: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(1000).default(100),
  api_version: z.enum(["v5", "v501"]).default("v5"),
  field_names: z.array(z.string()).optional(),
  typed_field_names: z.array(z.string()).optional(),
  account: z.string().min(1).optional(),
  client_login: z.string().min(1).optional(),
});

export async function runDirectGetCampaignDetails(input: z.infer<typeof InputSchema>) {
  const parsed = InputSchema.parse(input);

  const selectionCriteria: Record<string, unknown> = {};
  if (parsed.ids) selectionCriteria.Ids = parsed.ids;
  if (parsed.states) selectionCriteria.States = parsed.states;
  if (parsed.types) selectionCriteria.Types = parsed.types;

  const isUnified = parsed.api_version === "v501";
  const endpoint = isUnified ? "/json/v501/campaigns" : "/json/v5/campaigns";
  const typedKey = isUnified ? "UnifiedCampaignFieldNames" : "TextCampaignFieldNames";

  try {
    const result = await executeApiCall({
      apiName: "direct",
      endpoint,
      body: {
        method: "get",
        params: {
          SelectionCriteria: selectionCriteria,
          FieldNames: parsed.field_names ?? DEFAULT_FIELD_NAMES,
          [typedKey]: parsed.typed_field_names ?? DEFAULT_TYPED_FIELD_NAMES,
          Page: { Limit: parsed.limit },
        },
      },
      account: parsed.account,
      client_login: parsed.client_login,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

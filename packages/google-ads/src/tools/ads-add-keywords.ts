import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_add_keywords";

const MATCH_TYPES = new Set(["EXACT", "PHRASE", "BROAD"]);

/** Adds positive keywords to an ad group, paused by default. */
export async function runAdsAddKeywords(args: {
  account?: string;
  customer_id: string;
  ad_group_id: string;
  keywords: Array<{ text: string; match_type?: string }>;
  enabled?: boolean;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const adGroupId = digitsOnly(args.ad_group_id);
  if (adGroupId.length === 0) return asText({ error: "ad_group_id is required" }, true);
  if (!args.keywords || args.keywords.length === 0) {
    return asText({ error: "keywords list is empty" }, true);
  }

  const operations: object[] = [];
  for (const kw of args.keywords) {
    const text = (kw.text ?? "").trim();
    if (text.length === 0) continue;
    const matchType = (kw.match_type ?? "PHRASE").trim().toUpperCase();
    if (!MATCH_TYPES.has(matchType)) {
      return asText({ error: `match_type must be EXACT, PHRASE or BROAD (got "${matchType}")` }, true);
    }
    operations.push({
      create: {
        adGroup: `customers/${customerId}/adGroups/${adGroupId}`,
        status: args.enabled === true ? "ENABLED" : "PAUSED",
        keyword: { text, matchType },
      },
    });
  }
  if (operations.length === 0) return asText({ error: "no valid keywords after trimming" }, true);

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "adGroupCriteria:mutate",
    operations,
    target: { customer_id: customerId, ad_group_id: adGroupId },
    change: { added: operations.length, status: args.enabled === true ? "ENABLED" : "PAUSED" },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

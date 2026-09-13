import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_add_negative_keywords";

const MATCH_TYPES = new Set(["EXACT", "PHRASE", "BROAD"]);

/** Adds negative keywords either to a campaign or to a single ad group. */
export async function runAdsAddNegativeKeywords(args: {
  account?: string;
  customer_id: string;
  level?: string;
  campaign_id?: string;
  ad_group_id?: string;
  keywords: string[];
  match_type?: string;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const level = (args.level ?? "campaign").trim().toLowerCase();
  if (level !== "campaign" && level !== "ad_group") {
    return asText({ error: "level must be 'campaign' or 'ad_group'" }, true);
  }
  const matchType = (args.match_type ?? "PHRASE").trim().toUpperCase();
  if (!MATCH_TYPES.has(matchType)) {
    return asText({ error: "match_type must be EXACT, PHRASE or BROAD" }, true);
  }
  if (!args.keywords || args.keywords.length === 0) {
    return asText({ error: "keywords list is empty" }, true);
  }

  const customerId = digitsOnly(args.customer_id);
  const parentId = digitsOnly(level === "campaign" ? args.campaign_id ?? "" : args.ad_group_id ?? "");
  if (parentId.length === 0) {
    return asText({ error: `${level}_id is required for level="${level}"` }, true);
  }

  const parentField =
    level === "campaign"
      ? { campaign: `customers/${customerId}/campaigns/${parentId}` }
      : { adGroup: `customers/${customerId}/adGroups/${parentId}` };

  const operations: object[] = [];
  for (const raw of args.keywords) {
    const text = (raw ?? "").trim();
    if (text.length === 0) continue;
    operations.push({ create: { ...parentField, negative: true, keyword: { text, matchType } } });
  }
  if (operations.length === 0) return asText({ error: "no valid keywords after trimming" }, true);

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: level === "campaign" ? "campaignCriteria:mutate" : "adGroupCriteria:mutate",
    operations,
    target: { customer_id: customerId, level, parent_id: parentId },
    change: { added: operations.length, match_type: matchType },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

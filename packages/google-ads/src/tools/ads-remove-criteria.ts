import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

/**
 * DANGER: removes criteria (keywords, negative keywords) or ads.
 *
 * All three tools share one body because the only difference is the endpoint
 * and the resource path; the acknowledge token still echoes the exact parent.
 */
export const TOOL_REMOVE_KEYWORDS = "ads_remove_keywords";
export const TOOL_REMOVE_NEGATIVE_KEYWORDS = "ads_remove_negative_keywords";
export const TOOL_REMOVE_ADS = "ads_remove_ads";

interface RemoveArgs {
  account?: string;
  customer_id: string;
  ad_group_id?: string;
  campaign_id?: string;
  criterion_ids?: string[];
  ad_ids?: string[];
  login_customer_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}

async function removeResources(
  toolName: string,
  endpoint: string,
  parentKind: "adGroups" | "campaigns",
  parentId: string,
  childSegment: string,
  ids: string[],
  args: RemoveArgs,
): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  if (parentId.length === 0) {
    return asText({ error: `${parentKind === "adGroups" ? "ad_group_id" : "campaign_id"} is required` }, true);
  }
  const clean = ids.map((id) => digitsOnly(id)).filter((id) => id.length > 0);
  if (clean.length === 0) return asText({ error: "no valid ids passed" }, true);

  const operations = clean.map((id) => ({
    remove: `customers/${customerId}/${childSegment}/${parentId}~${id}`,
  }));

  return runMutation({
    operation: toolName,
    customerId: args.customer_id,
    endpoint,
    operations,
    target: { customer_id: customerId, parent: `${parentKind}/${parentId}`, ids: clean },
    change: { action: "REMOVE", count: clean.length, irreversible: true },
    danger: true,
    resourceId: `${parentKind}/${parentId}`,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.acknowledge_live !== undefined ? { acknowledge_live: args.acknowledge_live } : {}),
  });
}

/** Removes positive keywords from an ad group. */
export function runAdsRemoveKeywords(args: RemoveArgs): Promise<McpText> {
  return removeResources(
    TOOL_REMOVE_KEYWORDS,
    "adGroupCriteria:mutate",
    "adGroups",
    digitsOnly(args.ad_group_id ?? ""),
    "adGroupCriteria",
    args.criterion_ids ?? [],
    args,
  );
}

/** Removes negative keywords from a campaign or an ad group. */
export function runAdsRemoveNegativeKeywords(args: RemoveArgs): Promise<McpText> {
  const campaignId = digitsOnly(args.campaign_id ?? "");
  if (campaignId.length > 0) {
    return removeResources(
      TOOL_REMOVE_NEGATIVE_KEYWORDS,
      "campaignCriteria:mutate",
      "campaigns",
      campaignId,
      "campaignCriteria",
      args.criterion_ids ?? [],
      args,
    );
  }
  return removeResources(
    TOOL_REMOVE_NEGATIVE_KEYWORDS,
    "adGroupCriteria:mutate",
    "adGroups",
    digitsOnly(args.ad_group_id ?? ""),
    "adGroupCriteria",
    args.criterion_ids ?? [],
    args,
  );
}

/** Removes ads from an ad group. */
export function runAdsRemoveAds(args: RemoveArgs): Promise<McpText> {
  return removeResources(
    TOOL_REMOVE_ADS,
    "adGroupAds:mutate",
    "adGroups",
    digitsOnly(args.ad_group_id ?? ""),
    "adGroupAds",
    args.ad_ids ?? [],
    args,
  );
}

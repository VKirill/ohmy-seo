import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_list_ads";

/** Ads with their creative payload and approval status. */
export async function runAdsListAds(args: {
  account?: string;
  customer_id: string;
  ad_group_id?: string;
  campaign_id?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const where = ["ad_group_ad.status != 'REMOVED'"];
  if (args.ad_group_id) where.push(`ad_group.id = ${digitsOnly(args.ad_group_id)}`);
  if (args.campaign_id) where.push(`campaign.id = ${digitsOnly(args.campaign_id)}`);

  const query = buildQuery({
    select: [
      "ad_group_ad.ad.id",
      "ad_group_ad.ad.type",
      "ad_group_ad.ad.final_urls",
      "ad_group_ad.ad.responsive_search_ad.headlines",
      "ad_group_ad.ad.responsive_search_ad.descriptions",
      "ad_group_ad.ad.responsive_search_ad.path1",
      "ad_group_ad.ad.responsive_search_ad.path2",
      "ad_group_ad.status",
      "ad_group_ad.ad_strength",
      "ad_group_ad.policy_summary.approval_status",
      "ad_group.id",
      "ad_group.name",
      "campaign.id",
      "campaign.name",
    ],
    from: "ad_group_ad",
    where,
  });

  return runGaqlTool({
    toolName: TOOL_NAME,
    customerId: args.customer_id,
    query,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.force_refresh !== undefined ? { forceRefresh: args.force_refresh } : {}),
  });
}

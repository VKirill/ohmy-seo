import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_list_keywords";

/** Positive keywords of an account, with match type and bid. */
export async function runAdsListKeywords(args: {
  account?: string;
  customer_id: string;
  ad_group_id?: string;
  campaign_id?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const where = [
    "ad_group_criterion.type = 'KEYWORD'",
    "ad_group_criterion.negative = FALSE",
    "ad_group_criterion.status != 'REMOVED'",
  ];
  if (args.ad_group_id) where.push(`ad_group.id = ${digitsOnly(args.ad_group_id)}`);
  if (args.campaign_id) where.push(`campaign.id = ${digitsOnly(args.campaign_id)}`);

  const query = buildQuery({
    select: [
      "ad_group_criterion.criterion_id",
      "ad_group_criterion.keyword.text",
      "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status",
      "ad_group_criterion.cpc_bid_micros",
      "ad_group_criterion.quality_info.quality_score",
      "ad_group.id",
      "ad_group.name",
      "campaign.id",
      "campaign.name",
    ],
    from: "ad_group_criterion",
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

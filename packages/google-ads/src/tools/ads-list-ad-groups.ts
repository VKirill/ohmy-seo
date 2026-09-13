import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_list_ad_groups";

/** Ad groups of an account, optionally narrowed to a single campaign. */
export async function runAdsListAdGroups(args: {
  account?: string;
  customer_id: string;
  campaign_id?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const where = ["ad_group.status != 'REMOVED'"];
  if (args.campaign_id) where.push(`campaign.id = ${digitsOnly(args.campaign_id)}`);

  const query = buildQuery({
    select: [
      "ad_group.id",
      "ad_group.name",
      "ad_group.status",
      "ad_group.type",
      "ad_group.cpc_bid_micros",
      "campaign.id",
      "campaign.name",
    ],
    from: "ad_group",
    where,
    orderBy: "campaign.name, ad_group.name",
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

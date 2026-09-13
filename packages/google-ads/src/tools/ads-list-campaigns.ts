import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_list_campaigns";

const STATUSES = new Set(["ENABLED", "PAUSED", "REMOVED"]);

/** Campaigns with budget, bidding strategy and channel type. No metrics. */
export async function runAdsListCampaigns(args: {
  account?: string;
  customer_id: string;
  status_filter?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const where: string[] = [];
  if (args.status_filter) {
    const status = args.status_filter.trim().toUpperCase();
    if (!STATUSES.has(status)) {
      return {
        isError: true as const,
        content: [
          { type: "text" as const, text: "status_filter must be ENABLED, PAUSED or REMOVED" },
        ],
      };
    }
    where.push(`campaign.status = '${status}'`);
  } else {
    where.push("campaign.status != 'REMOVED'");
  }

  const query = buildQuery({
    select: [
      "campaign.id",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      "campaign.advertising_channel_sub_type",
      "campaign.bidding_strategy_type",
      "campaign.start_date_time",
      "campaign.end_date_time",
      "campaign_budget.id",
      "campaign_budget.amount_micros",
      "campaign_budget.delivery_method",
    ],
    from: "campaign",
    where,
    orderBy: "campaign.name",
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

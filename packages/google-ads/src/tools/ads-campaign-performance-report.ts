import { asText, runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery, dateClause, GaqlError } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_campaign_performance_report";

/**
 * Campaign-level performance with impression-share loss split into budget and
 * rank, which is what tells you whether money or quality is the constraint.
 */
export async function runAdsCampaignPerformanceReport(args: {
  account?: string;
  customer_id: string;
  date_range?: string;
  only_active?: boolean;
  limit?: number;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  let where: string[];
  try {
    where = [dateClause(args.date_range ?? "LAST_30_DAYS")];
  } catch (e) {
    if (e instanceof GaqlError) return asText({ error: e.message }, true);
    throw e;
  }
  where.push(args.only_active ? "campaign.status = 'ENABLED'" : "campaign.status != 'REMOVED'");

  const query = buildQuery({
    select: [
      "campaign.id",
      "campaign.name",
      "campaign.status",
      "campaign.advertising_channel_type",
      "campaign.bidding_strategy_type",
      "campaign_budget.amount_micros",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.ctr",
      "metrics.average_cpc",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
      "metrics.cost_per_conversion",
      "metrics.search_impression_share",
      "metrics.search_budget_lost_impression_share",
      "metrics.search_rank_lost_impression_share",
    ],
    from: "campaign",
    where,
    orderBy: "metrics.cost_micros DESC",
    limit: args.limit ?? 100,
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

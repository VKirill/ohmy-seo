import { asText, runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery, dateClause, GaqlError } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_keyword_performance_report";

/**
 * Keyword performance including the three Quality Score components — the
 * number alone does not say what to fix, the components do.
 */
export async function runAdsKeywordPerformanceReport(args: {
  account?: string;
  customer_id: string;
  date_range?: string;
  campaign_id?: string;
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
  if (args.campaign_id) where.push(`campaign.id = ${digitsOnly(args.campaign_id)}`);

  const query = buildQuery({
    select: [
      "ad_group_criterion.keyword.text",
      "ad_group_criterion.keyword.match_type",
      "ad_group_criterion.status",
      "ad_group_criterion.quality_info.quality_score",
      "ad_group_criterion.quality_info.creative_quality_score",
      "ad_group_criterion.quality_info.post_click_quality_score",
      "ad_group_criterion.quality_info.search_predicted_ctr",
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.ctr",
      "metrics.average_cpc",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
      "metrics.search_impression_share",
      "metrics.search_rank_lost_impression_share",
    ],
    from: "keyword_view",
    where,
    orderBy: "metrics.cost_micros DESC",
    limit: args.limit ?? 200,
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

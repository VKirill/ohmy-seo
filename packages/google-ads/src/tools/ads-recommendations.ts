import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_recommendations";

/**
 * Google's own suggestions for the account. `resource_name` from each row is
 * what ads_apply_recommendation accepts.
 */
export async function runAdsRecommendations(args: {
  account?: string;
  customer_id: string;
  type_filter?: string;
  limit?: number;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const where: string[] = [];
  if (args.type_filter) {
    const type = args.type_filter.trim().toUpperCase().replace(/[^A-Z_]/g, "");
    if (type.length > 0) where.push(`recommendation.type = '${type}'`);
  }

  const query = buildQuery({
    select: [
      "recommendation.resource_name",
      "recommendation.type",
      "recommendation.dismissed",
      "recommendation.campaign",
      "recommendation.ad_group",
      "recommendation.impact.base_metrics.impressions",
      "recommendation.impact.base_metrics.clicks",
      "recommendation.impact.base_metrics.cost_micros",
      "recommendation.impact.base_metrics.conversions",
      "recommendation.impact.potential_metrics.impressions",
      "recommendation.impact.potential_metrics.clicks",
      "recommendation.impact.potential_metrics.cost_micros",
      "recommendation.impact.potential_metrics.conversions",
    ],
    from: "recommendation",
    where,
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

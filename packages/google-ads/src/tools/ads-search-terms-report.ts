import { asText, runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery, dateClause, GaqlError } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_search_terms_report";

/**
 * What people actually typed. The daily driver for negative-keyword cleanup:
 * `zero_conversions_only` narrows it straight to spend that bought nothing.
 */
export async function runAdsSearchTermsReport(args: {
  account?: string;
  customer_id: string;
  date_range?: string;
  min_impressions?: number;
  campaign_id?: string;
  zero_conversions_only?: boolean;
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

  const minImpressions = Math.max(0, Math.floor(args.min_impressions ?? 10));
  where.push(`metrics.impressions >= ${minImpressions}`);
  if (args.campaign_id) where.push(`campaign.id = ${digitsOnly(args.campaign_id)}`);
  if (args.zero_conversions_only) where.push("metrics.conversions = 0");

  const query = buildQuery({
    select: [
      "search_term_view.search_term",
      "search_term_view.status",
      "campaign.id",
      "campaign.name",
      "ad_group.id",
      "ad_group.name",
      "metrics.impressions",
      "metrics.clicks",
      "metrics.cost_micros",
      "metrics.conversions",
      "metrics.conversions_value",
    ],
    from: "search_term_view",
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

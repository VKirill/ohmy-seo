import { runGaqlTool, asText, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_list_negative_keywords";

/**
 * Negative keywords. Campaign-level and ad-group-level live in different
 * resources, so `level` picks which one to read.
 */
export async function runAdsListNegativeKeywords(args: {
  account?: string;
  customer_id: string;
  level?: string;
  campaign_id?: string;
  ad_group_id?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const level = (args.level ?? "campaign").trim().toLowerCase();
  if (level !== "campaign" && level !== "ad_group") {
    return asText({ error: "level must be 'campaign' or 'ad_group'" }, true);
  }

  const query =
    level === "campaign"
      ? buildQuery({
          select: [
            "campaign_criterion.criterion_id",
            "campaign_criterion.keyword.text",
            "campaign_criterion.keyword.match_type",
            "campaign_criterion.type",
            "campaign.id",
            "campaign.name",
          ],
          from: "campaign_criterion",
          where: [
            "campaign_criterion.negative = TRUE",
            "campaign_criterion.type = 'KEYWORD'",
            ...(args.campaign_id ? [`campaign.id = ${digitsOnly(args.campaign_id)}`] : []),
          ],
        })
      : buildQuery({
          select: [
            "ad_group_criterion.criterion_id",
            "ad_group_criterion.keyword.text",
            "ad_group_criterion.keyword.match_type",
            "ad_group.id",
            "ad_group.name",
            "campaign.id",
            "campaign.name",
          ],
          from: "ad_group_criterion",
          where: [
            "ad_group_criterion.negative = TRUE",
            "ad_group_criterion.type = 'KEYWORD'",
            ...(args.ad_group_id ? [`ad_group.id = ${digitsOnly(args.ad_group_id)}`] : []),
          ],
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

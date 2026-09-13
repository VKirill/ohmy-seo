import { runGaqlTool, asText, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_list_shared_sets";

/**
 * Shared negative lists in the account, or — with campaign_id — the lists
 * already attached to one campaign.
 *
 * Two different resources answer these two questions: shared_set holds the
 * lists themselves, campaign_shared_set holds the links. Passing campaign_id
 * switches to the second one, which is also where you get the link id needed
 * to detach.
 */
export async function runAdsListSharedSets(args: {
  account?: string;
  customer_id: string;
  campaign_id?: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const campaignId = args.campaign_id ? digitsOnly(args.campaign_id) : "";

  const query =
    campaignId !== ""
      ? buildQuery({
          select: [
            "campaign_shared_set.resource_name",
            "campaign_shared_set.status",
            "shared_set.id",
            "shared_set.name",
            "shared_set.type",
            "shared_set.member_count",
            "campaign.id",
            "campaign.name",
          ],
          from: "campaign_shared_set",
          where: ["campaign.id = " + campaignId],
        })
      : buildQuery({
          select: [
            "shared_set.id",
            "shared_set.name",
            "shared_set.type",
            "shared_set.member_count",
            "shared_set.reference_count",
            "shared_set.status",
          ],
          from: "shared_set",
          where: ["shared_set.status != 'REMOVED'"],
          orderBy: "shared_set.name",
        });

  if (args.customer_id === undefined || digitsOnly(args.customer_id).length === 0) {
    return asText({ error: "customer_id is required" }, true);
  }

  return runGaqlTool({
    toolName: TOOL_NAME,
    customerId: args.customer_id,
    query,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.force_refresh !== undefined ? { forceRefresh: args.force_refresh } : {}),
  });
}

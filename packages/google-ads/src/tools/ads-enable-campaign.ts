import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_enable_campaign";

/** DANGER: starts spending money. Requires confirm + acknowledge_live + env flag. */
export async function runAdsEnableCampaign(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  login_customer_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);

  const resourceName = `customers/${customerId}/campaigns/${campaignId}`;

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaigns:mutate",
    operations: [{ update: { resourceName, status: "ENABLED" }, updateMask: "status" }],
    target: { customer_id: customerId, campaign_id: campaignId },
    change: { status: "ENABLED", warning: "кампания начнёт тратить бюджет" },
    danger: true,
    resourceId: `campaigns/${campaignId}`,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.acknowledge_live !== undefined ? { acknowledge_live: args.acknowledge_live } : {}),
  });
}

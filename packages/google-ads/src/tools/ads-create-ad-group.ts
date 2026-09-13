import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_create_ad_group";

/**
 * Creates an ad group. Paused by default; `enabled:true` is allowed because an
 * ad group inside a paused campaign cannot spend.
 */
export async function runAdsCreateAdGroup(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  name: string;
  cpc_bid?: number;
  enabled?: boolean;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);

  const create: Record<string, unknown> = {
    name: args.name,
    campaign: `customers/${customerId}/campaigns/${campaignId}`,
    status: args.enabled === true ? "ENABLED" : "PAUSED",
    type: "SEARCH_STANDARD",
  };
  if (args.cpc_bid && args.cpc_bid > 0) {
    create["cpcBidMicros"] = String(Math.round(args.cpc_bid * 1_000_000));
  }

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "adGroups:mutate",
    operations: [{ create }],
    target: { customer_id: customerId, campaign_id: campaignId, name: args.name },
    change: { status: create["status"], cpc_bid: args.cpc_bid ?? null },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

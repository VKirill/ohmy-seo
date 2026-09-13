import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_detach_shared_set";

/**
 * DANGER: detaches a shared negative list from a campaign.
 *
 * This is the one direction that can only make a campaign match MORE queries.
 * Pulling a 192-word junk-traffic list off a live campaign opens the tap the
 * same evening, which is why it needs the acknowledge_live echo and the env
 * flag, while attaching does not.
 */
export async function runAdsDetachSharedSet(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  shared_set_id: string;
  login_customer_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  const sharedSetId = digitsOnly(args.shared_set_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);
  if (sharedSetId.length === 0) return asText({ error: "shared_set_id is required" }, true);

  const linkId = campaignId + "~" + sharedSetId;

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaignSharedSets:mutate",
    operations: [{ remove: "customers/" + customerId + "/campaignSharedSets/" + linkId }],
    target: { customer_id: customerId, campaign_id: campaignId, shared_set_id: sharedSetId },
    change: { detached: true },
    danger: true,
    resourceId: "campaignSharedSets/" + linkId,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.acknowledge_live !== undefined ? { acknowledge_live: args.acknowledge_live } : {}),
  });
}

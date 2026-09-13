import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_attach_shared_set";

/**
 * Attaches an existing shared negative list to a campaign.
 *
 * Not a DANGER tool: attaching a negative list can only narrow what the
 * campaign matches, never widen it. Detaching is the risky direction and lives
 * in ads_detach_shared_set.
 *
 * Get shared_set_id from ads_list_shared_sets.
 */
export async function runAdsAttachSharedSet(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  shared_set_id: string;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  const sharedSetId = digitsOnly(args.shared_set_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);
  if (sharedSetId.length === 0) return asText({ error: "shared_set_id is required" }, true);

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaignSharedSets:mutate",
    operations: [
      {
        create: {
          campaign: "customers/" + customerId + "/campaigns/" + campaignId,
          sharedSet: "customers/" + customerId + "/sharedSets/" + sharedSetId,
        },
      },
    ],
    target: { customer_id: customerId, campaign_id: campaignId, shared_set_id: sharedSetId },
    change: { attached: true },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

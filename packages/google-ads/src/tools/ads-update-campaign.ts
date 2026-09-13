import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_update_campaign";

/**
 * Renames a campaign. Name only, on purpose.
 *
 * Status lives in ads_enable_campaign and ads_pause_campaign, budget in
 * ads_update_budget — all of them DANGER tools. Keeping the rename separate
 * means renaming never becomes a way to start or stop spending by accident.
 */
export async function runAdsUpdateCampaign(args: {
  account?: string;
  customer_id: string;
  campaign_id: string;
  name: string;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const campaignId = digitsOnly(args.campaign_id);
  if (campaignId.length === 0) return asText({ error: "campaign_id is required" }, true);

  const name = (args.name ?? "").trim();
  if (name === "") return asText({ error: "name is required" }, true);
  if (name.length > 255) return asText({ error: "name длиннее 255 символов" }, true);

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaigns:mutate",
    operations: [
      {
        update: { resourceName: "customers/" + customerId + "/campaigns/" + campaignId, name },
        updateMask: "name",
      },
    ],
    target: { customer_id: customerId, campaign_id: campaignId },
    change: { name },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

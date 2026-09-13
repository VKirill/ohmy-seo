import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";

export const TOOL_NAME = "ads_create_campaign_budget";

/** Creates a daily budget. Amount is given in account currency, not micros. */
export async function runAdsCreateCampaignBudget(args: {
  account?: string;
  customer_id: string;
  name: string;
  daily_amount: number;
  explicitly_shared?: boolean;
  login_customer_id?: string;
  confirm?: boolean;
  validate_only?: boolean;
}): Promise<McpText> {
  if (!(args.daily_amount > 0)) {
    return asText({ error: "daily_amount must be greater than zero" }, true);
  }
  const amountMicros = Math.round(args.daily_amount * 1_000_000);

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaignBudgets:mutate",
    operations: [
      {
        create: {
          name: args.name,
          amountMicros: String(amountMicros),
          deliveryMethod: "STANDARD",
          explicitlyShared: args.explicitly_shared ?? false,
        },
      },
    ],
    target: { customer_id: args.customer_id, name: args.name },
    change: { daily_amount: args.daily_amount, amount_micros: amountMicros },
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.validate_only !== undefined ? { validate_only: args.validate_only } : {}),
  });
}

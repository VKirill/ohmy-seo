import { runMutation } from "../lib/ads-mutate.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { digitsOnly } from "../lib/ads-client.js";

export const TOOL_NAME = "ads_update_budget";

/**
 * DANGER: changes how much a live campaign may spend per day.
 * Amount is in account currency, not micros.
 */
export async function runAdsUpdateBudget(args: {
  account?: string;
  customer_id: string;
  budget_id: string;
  daily_amount: number;
  login_customer_id?: string;
  confirm?: boolean;
  acknowledge_live?: string;
}): Promise<McpText> {
  const customerId = digitsOnly(args.customer_id);
  const budgetId = digitsOnly(args.budget_id);
  if (budgetId.length === 0) return asText({ error: "budget_id is required" }, true);
  if (!(args.daily_amount > 0)) {
    return asText({ error: "daily_amount must be greater than zero" }, true);
  }

  const amountMicros = Math.round(args.daily_amount * 1_000_000);
  const resourceName = `customers/${customerId}/campaignBudgets/${budgetId}`;

  return runMutation({
    operation: TOOL_NAME,
    customerId: args.customer_id,
    endpoint: "campaignBudgets:mutate",
    operations: [
      { update: { resourceName, amountMicros: String(amountMicros) }, updateMask: "amount_micros" },
    ],
    target: { customer_id: customerId, budget_id: budgetId },
    change: { daily_amount: args.daily_amount, amount_micros: amountMicros },
    danger: true,
    resourceId: `campaignBudgets/${budgetId}`,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.acknowledge_live !== undefined ? { acknowledge_live: args.acknowledge_live } : {}),
  });
}

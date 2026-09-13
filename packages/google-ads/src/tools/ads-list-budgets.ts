import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_list_budgets";

/** Shared and campaign budgets with their amounts. */
export async function runAdsListBudgets(args: {
  account?: string;
  customer_id: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const query = buildQuery({
    select: [
      "campaign_budget.id",
      "campaign_budget.name",
      "campaign_budget.amount_micros",
      "campaign_budget.delivery_method",
      "campaign_budget.explicitly_shared",
      "campaign_budget.status",
      "campaign_budget.reference_count",
    ],
    from: "campaign_budget",
    where: ["campaign_budget.status != 'REMOVED'"],
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

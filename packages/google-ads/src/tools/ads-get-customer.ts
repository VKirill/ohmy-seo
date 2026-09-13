import { runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_get_customer";

/** Account-level metadata: name, currency, time zone, manager flag, status. */
export async function runAdsGetCustomer(args: {
  account?: string;
  customer_id: string;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const query = buildQuery({
    select: [
      "customer.id",
      "customer.descriptive_name",
      "customer.currency_code",
      "customer.time_zone",
      "customer.manager",
      "customer.test_account",
      "customer.status",
      "customer.auto_tagging_enabled",
      "customer.tracking_url_template",
    ],
    from: "customer",
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

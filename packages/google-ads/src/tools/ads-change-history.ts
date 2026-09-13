import { asText, runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { buildQuery, GaqlError } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_change_history";

/** Who changed what, and when. Google caps this resource at 30 days. */
export async function runAdsChangeHistory(args: {
  account?: string;
  customer_id: string;
  days?: number;
  limit?: number;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  const days = Math.min(Math.max(1, Math.floor(args.days ?? 30)), 30);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 200)), 10_000);

  let query: string;
  try {
    query = buildQuery({
      select: [
        "change_event.change_date_time",
        "change_event.change_resource_type",
        "change_event.resource_change_operation",
        "change_event.changed_fields",
        "change_event.client_type",
        "change_event.user_email",
        "change_event.campaign",
        "change_event.ad_group",
      ],
      from: "change_event",
      where: [`change_event.change_date_time BETWEEN '${since}' AND '${until}'`],
      orderBy: "change_event.change_date_time DESC",
      limit,
    });
  } catch (e) {
    if (e instanceof GaqlError) return asText({ error: e.message }, true);
    throw e;
  }

  return runGaqlTool({
    toolName: TOOL_NAME,
    customerId: args.customer_id,
    query,
    warnings: ["change_event хранит только последние 30 дней — это ограничение API."],
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.force_refresh !== undefined ? { forceRefresh: args.force_refresh } : {}),
  });
}

import { asText, runGaqlTool, type McpText } from "../lib/ads-runner.js";
import { GaqlError, validateRawGaql } from "../lib/gaql-builder.js";

export const TOOL_NAME = "ads_run_query";

/**
 * Raw GAQL escape hatch. The query is validated before a request is spent:
 * shape, single statement, primary field, LIMIT, date range.
 */
export async function runAdsRunQuery(args: {
  account?: string;
  customer_id: string;
  query: string;
  limit?: number;
  login_customer_id?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  let validated;
  try {
    validated = validateRawGaql(args.query, args.limit ?? 500);
  } catch (e) {
    if (e instanceof GaqlError) {
      return asText({ error: e.message, query: args.query }, true);
    }
    throw e;
  }

  return runGaqlTool({
    toolName: TOOL_NAME,
    customerId: args.customer_id,
    query: validated.query,
    warnings: validated.warnings,
    ...(args.account !== undefined ? { account: args.account } : {}),
    ...(args.login_customer_id !== undefined ? { loginCustomerId: args.login_customer_id } : {}),
    ...(args.force_refresh !== undefined ? { forceRefresh: args.force_refresh } : {}),
  });
}

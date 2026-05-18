import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";

const PKG_NAME = "ga4";
const DATA_API_BASE = "https://analyticsdata.googleapis.com";

function normalizeProperty(s: string): string {
  return s.startsWith("properties/") ? s : `properties/${s}`;
}

export interface RunRealtimeReportArgs {
  account?: string;
  property: string;
  dimensions?: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  dimensionFilter?: object;
  metricFilter?: object;
  orderBys?: object[];
  limit?: number;
  minuteRanges?: Array<{ name?: string; startMinutesAgo?: number; endMinutesAgo?: number }>;
  returnPropertyQuota?: boolean;
}

export async function runGa4RunRealtimeReport(args: RunRealtimeReportArgs) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_READONLY, args.account);
    const property = normalizeProperty(args.property);
    const path = `v1beta/${property}:runRealtimeReport`;

    const body: Record<string, unknown> = {
      metrics: args.metrics,
    };
    if (args.dimensions !== undefined) body.dimensions = args.dimensions;
    if (args.dimensionFilter !== undefined) body.dimensionFilter = args.dimensionFilter;
    if (args.metricFilter !== undefined) body.metricFilter = args.metricFilter;
    if (args.orderBys !== undefined) body.orderBys = args.orderBys;
    if (args.limit !== undefined) body.limit = String(args.limit);
    if (args.minuteRanges !== undefined) body.minuteRanges = args.minuteRanges;
    if (args.returnPropertyQuota !== undefined) body.returnPropertyQuota = args.returnPropertyQuota;

    const result = await executeGa4Call({
      account,
      scope: SCOPE_GA4_READONLY,
      method: "POST",
      path,
      baseUrl: DATA_API_BASE,
      body,
    });

    if (!result.ok) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

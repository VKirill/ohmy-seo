import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";

const PKG_NAME = "ga4";
const DATA_API_BASE = "https://analyticsdata.googleapis.com";
const TOOL_NAME = "ga4_run_report";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GA4_CACHE_TTL_REPORT",
  ttlDefaultSeconds: 3600,
});

function normalizeProperty(s: string): string {
  return s.startsWith("properties/") ? s : `properties/${s}`;
}

export interface RunReportArgs {
  account?: string;
  property: string;
  dimensions: Array<{ name: string }>;
  metrics: Array<{ name: string; expression?: string }>;
  dateRanges: Array<{ startDate: string; endDate: string; name?: string }>;
  dimensionFilter?: object;
  metricFilter?: object;
  orderBys?: object[];
  limit?: number;
  offset?: number;
  keepEmptyRows?: boolean;
  returnPropertyQuota?: boolean;
}

export async function runGa4RunReport(args: RunReportArgs) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_READONLY, args.account);
    const property = normalizeProperty(args.property);
    const path = `v1beta/${property}:runReport`;

    const body: Record<string, unknown> = {
      dimensions: args.dimensions,
      metrics: args.metrics,
      dateRanges: args.dateRanges,
    };
    if (args.dimensionFilter !== undefined) body.dimensionFilter = args.dimensionFilter;
    if (args.metricFilter !== undefined) body.metricFilter = args.metricFilter;
    if (args.orderBys !== undefined) body.orderBys = args.orderBys;
    if (args.limit !== undefined) body.limit = String(args.limit);
    if (args.offset !== undefined) body.offset = String(args.offset);
    if (args.keepEmptyRows !== undefined) body.keepEmptyRows = args.keepEmptyRows;
    if (args.returnPropertyQuota !== undefined) body.returnPropertyQuota = args.returnPropertyQuota;

    const result = await withCache(
      {
        toolName: TOOL_NAME,
        accountId: account.id,
        args: { path, body },
        forceRefresh: false,
        skipCacheIf: (r: unknown) => !(r as { ok?: boolean }).ok,
      },
      () =>
        executeGa4Call({
          account,
          scope: SCOPE_GA4_READONLY,
          method: "POST",
          path,
          baseUrl: DATA_API_BASE,
          body,
        })
    );

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

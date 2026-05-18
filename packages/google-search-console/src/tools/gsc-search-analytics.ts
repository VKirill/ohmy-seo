import { SCOPE_GSC_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_search_analytics";

registerCacheableTool(TOOL_NAME, { ttlEnvKey: "MCP_GSC_CACHE_TTL_SEARCH", ttlDefaultSeconds: 3600 });

export const schema = {
  name: TOOL_NAME,
  description: "Queries GSC Search Analytics (clicks, impressions, CTR, position) for a site property.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: { type: "string", description: "Registered Google account label (uses default if omitted)." },
      siteUrl: { type: "string", description: "Property URL, e.g. 'sc-domain:example.com' or 'https://example.com/'." },
      startDate: { type: "string", description: "Start date YYYY-MM-DD (Pacific Time)." },
      endDate: { type: "string", description: "End date YYYY-MM-DD (Pacific Time)." },
      dimensions: {
        type: "array",
        items: { type: "string", enum: ["query", "page", "country", "device", "searchAppearance", "date"] },
        description: "Dimensions to group results by.",
      },
      dimensionFilterGroups: {
        type: "array",
        items: { type: "object" },
        description: "Array of dimension filter groups (groupType: 'and').",
      },
      type: { type: "string", enum: ["web", "image", "video", "news", "discover", "googleNews"], description: "Search type filter." },
      dataState: { type: "string", enum: ["final", "all"], description: "'final' (default) for stable data; 'all' includes recent rows." },
      rowLimit: { type: "number", description: "Max rows (1–25000, default 1000)." },
      startRow: { type: "number", description: "Pagination offset (default 0)." },
      aggregationType: { type: "string", enum: ["auto", "byPage", "byProperty"], description: "Impression aggregation mode." },
      force_refresh: { type: "boolean", description: "Bypass cache and fetch fresh data." },
    },
    required: ["siteUrl", "startDate", "endDate"],
  },
};

interface SearchAnalyticsArgs {
  account?: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  dimensionFilterGroups?: unknown[];
  type?: string;
  dataState?: string;
  rowLimit?: number;
  startRow?: number;
  aggregationType?: string;
  force_refresh?: boolean;
}

export async function runGscSearchAnalytics(args: SearchAnalyticsArgs) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GSC_READONLY, args.account);

  const body: Record<string, unknown> = { startDate: args.startDate, endDate: args.endDate };
  if (args.dimensions !== undefined) body.dimensions = args.dimensions;
  if (args.dimensionFilterGroups !== undefined) body.dimensionFilterGroups = args.dimensionFilterGroups;
  if (args.type !== undefined) body.type = args.type;
  if (args.dataState !== undefined) body.dataState = args.dataState;
  if (args.rowLimit !== undefined) body.rowLimit = args.rowLimit;
  if (args.startRow !== undefined) body.startRow = args.startRow;
  if (args.aggregationType !== undefined) body.aggregationType = args.aggregationType;

  const encodedSiteUrl = encodeURIComponent(args.siteUrl);

  return withCache<{ rows: unknown[]; responseAggregationType: string | undefined; raw_count: number }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: { account: args.account ?? null, siteUrl: args.siteUrl, ...body },
      forceRefresh: args.force_refresh ?? false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGscCall({
        account,
        scope: SCOPE_GSC_READONLY,
        method: "POST",
        path: `/v1/sites/${encodedSiteUrl}/searchAnalytics/query`,
        body,
      });

      const data = result.data as Record<string, unknown>;
      const rows: unknown[] = (data?.rows as unknown[]) ?? [];
      return { rows, responseAggregationType: data?.responseAggregationType as string | undefined, raw_count: rows.length };
    }
  );
}

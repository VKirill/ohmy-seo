import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";

const PKG_NAME = "ga4";
const DATA_API_BASE = "https://analyticsdata.googleapis.com";
const TOOL_NAME = "ga4_batch_run_reports";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GA4_CACHE_TTL_REPORT",
  ttlDefaultSeconds: 3600,
});

function normalizeProperty(s: string): string {
  return s.startsWith("properties/") ? s : `properties/${s}`;
}

export interface BatchRunReportsArgs {
  account?: string;
  property: string;
  /** Up to 5 report requests. Each is a RunReport body (without property). */
  requests: object[];
}

export async function runGa4BatchRunReports(args: BatchRunReportsArgs) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_READONLY, args.account);
    const property = normalizeProperty(args.property);
    const path = `v1beta/${property}:batchRunReports`;

    const body = { requests: args.requests };

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

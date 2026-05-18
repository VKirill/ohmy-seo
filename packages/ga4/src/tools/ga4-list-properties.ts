import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";

const PKG_NAME = "ga4";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com";
const TOOL_NAME = "ga4_list_properties";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GA4_CACHE_TTL_META",
  ttlDefaultSeconds: 86_400,
});

export async function runGa4ListProperties(args: { account?: string }) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_READONLY, args.account);

    const result = await withCache(
      {
        toolName: TOOL_NAME,
        accountId: account.id,
        args: { path: "v1beta/accountSummaries" },
        forceRefresh: false,
        skipCacheIf: (r: unknown) => !(r as { ok?: boolean }).ok,
      },
      () =>
        executeGa4Call({
          account,
          scope: SCOPE_GA4_READONLY,
          method: "GET",
          path: "v1beta/accountSummaries",
          baseUrl: ADMIN_API_BASE,
        })
    );

    if (!result.ok) {
      return {
        isError: true as const,
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    }

    const data = result.data as { accountSummaries?: unknown[] };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { account_summaries: data.accountSummaries ?? [] },
            null,
            2
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

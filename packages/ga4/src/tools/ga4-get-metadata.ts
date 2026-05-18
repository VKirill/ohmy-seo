import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_GA4_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGa4Call } from "../lib/ga4-client.js";

const PKG_NAME = "ga4";
const DATA_API_BASE = "https://analyticsdata.googleapis.com";
const TOOL_NAME = "ga4_get_metadata";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GA4_CACHE_TTL_META",
  ttlDefaultSeconds: 86_400,
});

function normalizeProperty(s: string): string {
  return s.startsWith("properties/") ? s : `properties/${s}`;
}

export async function runGa4GetMetadata(args: { account?: string; property: string }) {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_GA4_READONLY, args.account);
    const property = normalizeProperty(args.property);
    const path = `v1beta/${property}/metadata`;

    const result = await withCache(
      {
        toolName: TOOL_NAME,
        accountId: account.id,
        args: { path },
        forceRefresh: false,
        skipCacheIf: (r: unknown) => !(r as { ok?: boolean }).ok,
      },
      () =>
        executeGa4Call({
          account,
          scope: SCOPE_GA4_READONLY,
          method: "GET",
          path,
          baseUrl: DATA_API_BASE,
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

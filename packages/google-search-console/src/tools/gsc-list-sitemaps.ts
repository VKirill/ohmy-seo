import { SCOPE_GSC_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_list_sitemaps";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_META",
  ttlDefaultSeconds: 86400,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all sitemaps submitted for a site property in Google Search Console.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      siteUrl: {
        type: "string",
        description: "The site property URL (e.g. https://example.com/ or sc-domain:example.com).",
      },
    },
    required: ["siteUrl"],
  },
};

export async function runGscListSitemaps(args: { account?: string; siteUrl: string }) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GSC_READONLY, args.account);

  return withCache<{ sitemap: unknown[] }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: { account: args.account ?? null, siteUrl: args.siteUrl },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const encodedSiteUrl = encodeURIComponent(args.siteUrl);

      const result = await executeGscCall({
        account,
        scope: SCOPE_GSC_READONLY,
        method: "GET",
        path: `/webmasters/v3/sites/${encodedSiteUrl}/sitemaps`,
      });

      const sitemap: unknown[] =
        (result.data as Record<string, unknown>)?.sitemap as unknown[] ?? [];

      return { sitemap };
    }
  );
}

import { SCOPE_GSC_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGscCall } from "../lib/gsc-client.js";

const PKG_NAME = "google-search-console";
const TOOL_NAME = "gsc_list_sites";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GSC_CACHE_TTL_META",
  ttlDefaultSeconds: 86400,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all sites (properties) accessible in Google Search Console for the resolved account.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
    },
    required: [],
  },
};

export async function runGscListSites(args: { account?: string }) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GSC_READONLY, args.account);

  return withCache<{ sites: unknown[]; permission_levels: Record<string, string> }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: { account: args.account ?? null },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGscCall({
        account,
        scope: SCOPE_GSC_READONLY,
        method: "GET",
        path: "/webmasters/v3/sites",
      });

      const entries: unknown[] = (result.data as Record<string, unknown>)?.siteEntry as unknown[] ?? [];

      const permission_levels: Record<string, string> = {};
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        if (typeof e.siteUrl === "string" && typeof e.permissionLevel === "string") {
          permission_levels[e.siteUrl] = e.permissionLevel;
        }
      }

      return { sites: entries, permission_levels };
    }
  );
}

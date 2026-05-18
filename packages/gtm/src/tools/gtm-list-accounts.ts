import { SCOPE_GTM_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_list_accounts";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all GTM accounts accessible to the resolved Google account.",
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

export async function runGtmListAccounts(args: { account?: string }) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_READONLY, args.account);

  return withCache<{ accounts: unknown[] }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: { account: args.account ?? null },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGtmCall({
        account,
        scope: SCOPE_GTM_READONLY,
        method: "GET",
        path: "accounts",
      });

      const accounts: unknown[] =
        (result.data as Record<string, unknown>)?.account as unknown[] ?? [];

      return { accounts };
    }
  );
}

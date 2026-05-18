import { SCOPE_GTM_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_list_containers";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all containers in a GTM account.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: {
        type: "string",
        description: "GTM Account ID (numeric string).",
      },
    },
    required: ["accountId"],
  },
};

export async function runGtmListContainers(args: { account?: string; accountId: string }) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_READONLY, args.account);

  return withCache<{ containers: unknown[] }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: { account: args.account ?? null, accountId: args.accountId },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGtmCall({
        account,
        scope: SCOPE_GTM_READONLY,
        method: "GET",
        path: `accounts/${args.accountId}/containers`,
      });

      const containers: unknown[] =
        (result.data as Record<string, unknown>)?.container as unknown[] ?? [];

      return { containers };
    }
  );
}

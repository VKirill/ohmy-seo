import { SCOPE_GTM_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_list_workspaces";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all workspaces in a GTM container.",
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
      containerId: {
        type: "string",
        description: "GTM Container ID (numeric string).",
      },
    },
    required: ["accountId", "containerId"],
  },
};

export async function runGtmListWorkspaces(args: {
  account?: string;
  accountId: string;
  containerId: string;
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_READONLY, args.account);

  return withCache<{ workspaces: unknown[] }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: {
        account: args.account ?? null,
        accountId: args.accountId,
        containerId: args.containerId,
      },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGtmCall({
        account,
        scope: SCOPE_GTM_READONLY,
        method: "GET",
        path: `accounts/${args.accountId}/containers/${args.containerId}/workspaces`,
      });

      const workspaces: unknown[] =
        (result.data as Record<string, unknown>)?.workspace as unknown[] ?? [];

      return { workspaces };
    }
  );
}

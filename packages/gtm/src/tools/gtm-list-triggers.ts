import { SCOPE_GTM_READONLY } from "@ohmy-seo/mcp-core/google-oauth";
import { withCache, registerCacheableTool } from "@ohmy-seo/mcp-core/cache";
import { resolveAccount } from "../lib/account-resolver.js";
import { executeGtmCall } from "../lib/gtm-client.js";

const PKG_NAME = "gtm";
const TOOL_NAME = "gtm_list_triggers";

registerCacheableTool(TOOL_NAME, {
  ttlEnvKey: "MCP_GTM_CACHE_TTL_READ",
  ttlDefaultSeconds: 3600,
});

export const schema = {
  name: TOOL_NAME,
  description: "Lists all triggers in a GTM workspace.",
  inputSchema: {
    type: "object" as const,
    properties: {
      account: {
        type: "string",
        description: "Label of a registered Google account (optional; uses default if omitted).",
      },
      accountId: { type: "string", description: "GTM Account ID." },
      containerId: { type: "string", description: "GTM Container ID." },
      workspaceId: { type: "string", description: "GTM Workspace ID." },
    },
    required: ["accountId", "containerId", "workspaceId"],
  },
};

export async function runGtmListTriggers(args: {
  account?: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
}) {
  const account = await resolveAccount(PKG_NAME, SCOPE_GTM_READONLY, args.account);
  const path = `accounts/${args.accountId}/containers/${args.containerId}/workspaces/${args.workspaceId}/triggers`;

  return withCache<{ triggers: unknown[] }>(
    {
      toolName: TOOL_NAME,
      accountId: account.id,
      args: {
        account: args.account ?? null,
        accountId: args.accountId,
        containerId: args.containerId,
        workspaceId: args.workspaceId,
      },
      forceRefresh: false,
      packageName: PKG_NAME,
    },
    async () => {
      const result = await executeGtmCall({
        account: {
          ...account,
          access_token: account.access_token ?? undefined,
          refresh_token: account.refresh_token ?? undefined,
          service_account_json: account.service_account_json ?? undefined,
        },
        scope: SCOPE_GTM_READONLY,
        method: "GET",
        path,
      });

      const triggers: unknown[] =
        (result.data as Record<string, unknown>)?.trigger as unknown[] ?? [];

      return { triggers };
    }
  );
}

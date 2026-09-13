import { withCache } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { SCOPE_ADWORDS } from "@ohmy-seo/mcp-core/google-oauth";
import { resolveAccount } from "../lib/account-resolver.js";
import { adsSearch, envLoginCustomerId, executeAdsCall } from "../lib/ads-client.js";
import { asText, type McpText } from "../lib/ads-runner.js";
import { buildQuery } from "../lib/gaql-builder.js";

const PKG_NAME = "google-ads";
export const TOOL_NAME = "ads_list_accessible_customers";

/**
 * Lists every customer the authorized Google account can reach, and — when a
 * manager account is configured — enriches the flat list with names, currency
 * and status pulled from the manager's account tree in a single extra call.
 */
export async function runAdsListAccessibleCustomers(args: {
  account?: string;
  force_refresh?: boolean;
}): Promise<McpText> {
  try {
    const account = await resolveAccount(PKG_NAME, SCOPE_ADWORDS, args.account);
    const manager = envLoginCustomerId();

    const result = await withCache(
      {
        toolName: TOOL_NAME,
        accountId: account.id,
        args: { manager: manager ?? null },
        forceRefresh: args.force_refresh ?? false,
        skipCacheIf: (r: unknown) => !(r as { ok?: boolean }).ok,
      },
      async () => {
        const listed = await executeAdsCall({
          account,
          method: "GET",
          path: "customers:listAccessibleCustomers",
          managerFallback: false,
        });
        if (!listed.ok) return { ok: false as const, accessible: listed.data };

        const names = (listed.data as { resourceNames?: string[] }).resourceNames ?? [];
        const ids = names.map((n) => n.split("/")[1] ?? "");

        let tree: unknown = null;
        if (manager) {
          const q = buildQuery({
            select: [
              "customer_client.id",
              "customer_client.descriptive_name",
              "customer_client.manager",
              "customer_client.status",
              "customer_client.currency_code",
              "customer_client.time_zone",
              "customer_client.level",
            ],
            from: "customer_client",
            where: ["customer_client.status != 'CANCELED'"],
          });
          const linked = await adsSearch(account, manager, q, manager);
          tree = linked.ok ? linked.rows : linked.error;
        }

        return { ok: true as const, accessible_ids: ids, manager_account: manager ?? null, linked_to_manager: tree };
      },
    );

    return asText(result, !(result as { ok?: boolean }).ok);
  } catch (e) {
    return errorToMcpContent(e) as McpText;
  }
}

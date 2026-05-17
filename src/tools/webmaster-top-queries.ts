import { getTopQueries } from "../lib/webmaster-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccountById } from "../lib/db/accounts-repo.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";
import { pickUniqueSiteOrThrow, resolveAccountByHostId } from "../lib/property-resolver.js";
import { getSitesWithPolicy } from "../lib/inventory/cache-policy.js";
import { withCache } from "../lib/cache/cache-policy.js";

export async function runWebmasterTopQueries(input: {
  host_id?: string;
  site?: string;
  date_from: string;
  date_to: string;
  limit: number;
  query_filter?: string;
  account?: string;
  force_refresh?: boolean;
}) {
  try {
    let acc;
    if (input.account) {
      acc = resolveAccount(SCOPES.WEBMASTER_HOSTINFO, input.account);
    } else if (input.host_id) {
      const smartAccId = resolveAccountByHostId(input.host_id);
      acc = smartAccId !== null
        ? getAccountById(smartAccId) ?? resolveAccount(SCOPES.WEBMASTER_HOSTINFO)
        : resolveAccount(SCOPES.WEBMASTER_HOSTINFO);
    } else {
      acc = resolveAccount(SCOPES.WEBMASTER_HOSTINFO);
    }
    if (!acc.webmaster_user_id) {
      throw new Error(`Account '${acc.label}' has no webmaster_user_id (probe failed at connect). Reconnect: delete_account + start_oauth_flow + complete_oauth_flow.`);
    }
    let hostId = input.host_id;
    if (!hostId) {
      if (!input.site) throw new Error("Provide either host_id or site.");
      const sites = await getSitesWithPolicy(acc.id);
      hostId = pickUniqueSiteOrThrow(input.site, sites, { accountLabel: acc.label });
    }
    const canonicalArgs: Record<string, unknown> = {
      host_id: hostId,
      date_from: input.date_from,
      date_to: input.date_to,
      limit: input.limit,
      ...(input.query_filter !== undefined && { query_filter: input.query_filter }),
    };
    const result = await withCache(
      { toolName: "webmaster_top_queries", accountId: acc.id, args: canonicalArgs, forceRefresh: input.force_refresh ?? false },
      async () => {
        const accessToken = await getAccessToken(acc.id);
        return getTopQueries({
          accessToken,
          webmasterUserId: String(acc.webmaster_user_id),
          host: hostId!,
          dateFrom: input.date_from,
          dateTo: input.date_to,
          limit: input.limit,
          queryFilter: input.query_filter,
        });
      }
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

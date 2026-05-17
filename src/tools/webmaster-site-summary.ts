import { getSiteSummary } from "../lib/webmaster-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";
import { pickUniqueSiteOrThrow } from "../lib/property-resolver.js";
import { getSitesWithPolicy } from "../lib/inventory/cache-policy.js";

export async function runWebmasterSiteSummary(input: { host_id?: string; site?: string; account?: string }) {
  try {
    const acc = resolveAccount(SCOPES.WEBMASTER_HOSTINFO, input.account);
    if (!acc.webmaster_user_id) {
      throw new Error(`Account '${acc.label}' has no webmaster_user_id (probe failed at connect). Reconnect: delete_account + start_oauth_flow + complete_oauth_flow.`);
    }
    let hostId = input.host_id;
    if (!hostId) {
      if (!input.site) throw new Error("Provide either host_id or site.");
      const sites = await getSitesWithPolicy(acc.id);
      hostId = pickUniqueSiteOrThrow(input.site, sites, { accountLabel: acc.label });
    }
    const accessToken = await getAccessToken(acc.id);
    const result = await getSiteSummary({ accessToken, webmasterUserId: String(acc.webmaster_user_id), host: hostId });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

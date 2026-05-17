import { getTopQueries } from "../lib/webmaster-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runWebmasterTopQueries(input: {
  host: string;
  date_from: string;
  date_to: string;
  limit: number;
  query_filter?: string;
  account?: string;
}) {
  try {
    const acc = resolveAccount(SCOPES.WEBMASTER_HOSTINFO, input.account);
    if (!acc.webmaster_user_id) {
      throw new Error(`Account '${acc.label}' has no webmaster_user_id (probe failed at connect). Reconnect: delete_account + start_oauth_flow + complete_oauth_flow.`);
    }
    const accessToken = await getAccessToken(acc.id);
    const result = await getTopQueries({
      accessToken,
      webmasterUserId: String(acc.webmaster_user_id),
      host: input.host,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      limit: input.limit,
      queryFilter: input.query_filter,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

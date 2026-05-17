import { getIndexingIssues } from "../lib/webmaster-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runWebmasterIndexingIssues(input: { host: string; account?: string }) {
  try {
    const acc = resolveAccount(SCOPES.WEBMASTER_HOSTINFO, input.account);
    if (!acc.webmaster_user_id) {
      throw new Error(`Account '${acc.label}' has no webmaster_user_id (probe failed at connect). Reconnect: delete_account + start_oauth_flow + complete_oauth_flow.`);
    }
    const accessToken = await getAccessToken(acc.id);
    const result = await getIndexingIssues({ accessToken, webmasterUserId: String(acc.webmaster_user_id), host: input.host });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

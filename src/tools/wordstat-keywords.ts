import { wordstatKeywords } from "../lib/direct-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runWordstatKeywords(input: {
  phrases: string[];
  geo_id?: number[];
  poll_timeout_sec?: number;
  client_login?: string;
  account?: string;
}) {
  try {
    const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
    const accessToken = await getAccessToken(acc.id);
    const result = await wordstatKeywords({
      accessToken,
      clientLogin: input.client_login,
      phrases: input.phrases,
      geoIds: input.geo_id,
      pollTimeoutSec: input.poll_timeout_sec ?? 120,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

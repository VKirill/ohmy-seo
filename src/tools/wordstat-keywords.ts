import { wordstatKeywords } from "../lib/direct-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";
import { withCache } from "../lib/cache/cache-policy.js";

export async function runWordstatKeywords(input: {
  phrases: string[];
  geo_id?: number[];
  poll_timeout_sec?: number;
  client_login?: string;
  account?: string;
  force_refresh?: boolean;
}) {
  try {
    const acc = resolveAccount(SCOPES.DIRECT_API, input.account);
    const canonicalArgs: Record<string, unknown> = {
      phrases: input.phrases,
      ...(input.geo_id !== undefined && { geo_id: input.geo_id }),
      ...(input.poll_timeout_sec !== undefined && { poll_timeout_sec: input.poll_timeout_sec }),
      ...(input.client_login !== undefined && { client_login: input.client_login }),
    };
    const result = await withCache(
      { toolName: "wordstat_keywords", accountId: acc.id, args: canonicalArgs, forceRefresh: input.force_refresh ?? false },
      async () => {
        const accessToken = await getAccessToken(acc.id);
        return wordstatKeywords({
          accessToken,
          clientLogin: input.client_login,
          phrases: input.phrases,
          geoIds: input.geo_id,
          pollTimeoutSec: input.poll_timeout_sec ?? 120,
        });
      }
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

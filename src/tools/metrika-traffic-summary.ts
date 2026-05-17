import { getTrafficSummary } from "../lib/metrika-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";
import { pickUniqueCounterOrThrow } from "../lib/property-resolver.js";
import { getCountersWithPolicy } from "../lib/inventory/cache-policy.js";
import { withCache } from "../lib/cache/cache-policy.js";

export async function runMetrikaTrafficSummary(input: {
  counter_id?: string;
  site?: string;
  date_from: string;
  date_to: string;
  group_by?: "day" | "week" | "month" | "none";
  account?: string;
  force_refresh?: boolean;
}) {
  try {
    const acc = resolveAccount(SCOPES.METRIKA_READ, input.account);
    let counterId = input.counter_id;
    if (!counterId) {
      if (!input.site) throw new Error("Provide either counter_id or site.");
      const counters = await getCountersWithPolicy(acc.id);
      counterId = pickUniqueCounterOrThrow(input.site, counters, { accountLabel: acc.label });
    }
    const canonicalArgs: Record<string, unknown> = {
      counter_id: counterId,
      date_from: input.date_from,
      date_to: input.date_to,
      group_by: input.group_by ?? "none",
    };
    const result = await withCache(
      { toolName: "metrika_traffic_summary", accountId: acc.id, args: canonicalArgs, forceRefresh: input.force_refresh ?? false },
      async () => {
        const accessToken = await getAccessToken(acc.id);
        return getTrafficSummary({
          accessToken,
          counterId: counterId!,
          dateFrom: input.date_from,
          dateTo: input.date_to,
          groupBy: input.group_by ?? "none",
        });
      }
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

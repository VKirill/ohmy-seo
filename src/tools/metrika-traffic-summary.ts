import { getTrafficSummary } from "../lib/metrika-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runMetrikaTrafficSummary(input: {
  counter_id: string;
  date_from: string;
  date_to: string;
  group_by?: "day" | "week" | "month" | "none";
  account?: string;
}) {
  try {
    const acc = resolveAccount(SCOPES.METRIKA_READ, input.account);
    const accessToken = await getAccessToken(acc.id);
    const result = await getTrafficSummary({
      accessToken,
      counterId: input.counter_id,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      groupBy: input.group_by ?? "none",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

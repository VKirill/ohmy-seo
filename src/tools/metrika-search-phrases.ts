import { getSearchPhrases } from "../lib/metrika-client.js";
import { resolveAccount } from "../lib/account-resolver.js";
import { getAccessToken } from "../lib/oauth/token-broker.js";
import { SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runMetrikaSearchPhrases(input: {
  counter_id: string;
  date_from: string;
  date_to: string;
  limit: number;
  search_engine?: "yandex" | "google" | "all";
  account?: string;
}) {
  try {
    const acc = resolveAccount(SCOPES.METRIKA_READ, input.account);
    const accessToken = await getAccessToken(acc.id);
    const result = await getSearchPhrases({
      accessToken,
      counterId: input.counter_id,
      dateFrom: input.date_from,
      dateTo: input.date_to,
      limit: input.limit,
      searchEngine: input.search_engine ?? "all",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (e) { return errorToMcpContent(e); }
}

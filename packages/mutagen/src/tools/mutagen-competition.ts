import { getCompetition } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { withCache } from "@ohmy-seo/mcp-core/cache";

export async function runMutagenCompetition(input: {
  phrases: string[];
  poll_timeout_sec?: number;
  force_refresh?: boolean;
}) {
  try {
    const canonicalArgs: Record<string, unknown> = {
      phrases: input.phrases,
      ...(input.poll_timeout_sec !== undefined && { poll_timeout_sec: input.poll_timeout_sec }),
    };
    const result = await withCache(
      { toolName: "mutagen_competition", accountId: null, args: canonicalArgs, forceRefresh: input.force_refresh ?? false },
      () => getCompetition({ phrases: input.phrases, pollTimeoutSec: input.poll_timeout_sec ?? 60 })
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

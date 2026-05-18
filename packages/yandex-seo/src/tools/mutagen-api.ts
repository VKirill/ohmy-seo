import { executeMutagenMethod } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "../lib/errors.js";
import { withCache } from "../lib/cache/cache-policy.js";

export async function runMutagenApi(input: {
  method: string;
  params?: Record<string, unknown>;
  poll_timeout_sec?: number;
  force_refresh?: boolean;
}) {
  try {
    const params = input.params ?? {};
    const pollTimeoutSec = input.poll_timeout_sec ?? 60;
    const cacheArgs: Record<string, unknown> = { method: input.method, params };

    const result = await withCache(
      {
        toolName: "mutagen_api",
        accountId: null,
        args: cacheArgs,
        forceRefresh: input.force_refresh ?? false,
      },
      () => executeMutagenMethod(input.method, params, pollTimeoutSec),
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

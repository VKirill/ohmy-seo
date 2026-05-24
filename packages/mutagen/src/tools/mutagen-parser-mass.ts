import { executeMutagenMethod } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { withCache } from "@ohmy-seo/mcp-core/cache";

export async function runMutagenParserMass(input: {
  keys_list: string[] | string;
  name: string;
  parser: string;
  region_id?: string;
  poll_timeout_sec?: number;
  force_refresh?: boolean;
}) {
  try {
    // Normalize keys_list: if array, join with \n; if string, pass as-is
    const keysList = Array.isArray(input.keys_list)
      ? input.keys_list.join("\n")
      : input.keys_list;

    const params: Record<string, unknown> = {
      keys_list: keysList,
      name: input.name,
      parser: input.parser,
      region_id: input.region_id ?? "0",
    };

    // parser.mass jobs take longer — default 300s
    const pollTimeoutSec = input.poll_timeout_sec ?? 300;
    const cacheArgs: Record<string, unknown> = { method: "parser.mass", params };

    const result = await withCache(
      {
        toolName: "mutagen_api",
        accountId: null,
        args: cacheArgs,
        forceRefresh: input.force_refresh ?? false,
      },
      () => executeMutagenMethod("parser.mass", params, pollTimeoutSec),
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

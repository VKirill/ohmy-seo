import { executeMutagenMethod } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { withCache } from "@ohmy-seo/mcp-core/cache";

export async function runMutagenParserGet(input: {
  key: string;
  parser: string;
  region_id?: string;
  force_refresh?: boolean;
}) {
  try {
    const params: Record<string, unknown> = {
      key: input.key,
      parser: input.parser,
      region_id: input.region_id ?? "0",
    };
    const cacheArgs: Record<string, unknown> = { method: "parser.get", params };

    const result = await withCache(
      {
        toolName: "mutagen_api",
        accountId: null,
        args: cacheArgs,
        forceRefresh: input.force_refresh ?? false,
      },
      () => executeMutagenMethod("parser.get", params),
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

import { executeMutagenMethod } from "../lib/mutagen-client.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { withCache } from "@ohmy-seo/mcp-core/cache";

export async function runMutagenSerpReport(input: {
  region: string;
  report: string;
  keyword?: string;
  keywords?: string;
  domain?: string;
  domain_with_subdomains?: string;
  page?: string;
  filter?: unknown[];
  sort?: string;
  limit?: number;
  count?: number | boolean;
  force_refresh?: boolean;
}) {
  try {
    const params: Record<string, unknown> = {
      region: input.region,
      report: input.report,
    };

    // Exactly one of the element params should be provided
    if (input.keyword !== undefined) params.keyword = input.keyword;
    if (input.keywords !== undefined) params.keywords = input.keywords;
    if (input.domain !== undefined) params.domain = input.domain;
    if (input.domain_with_subdomains !== undefined) params.domain_with_subdomains = input.domain_with_subdomains;
    if (input.page !== undefined) params.page = input.page;

    // Optional params
    if (input.filter !== undefined) params.filter = input.filter;
    if (input.sort !== undefined) params.sort = input.sort;
    if (input.limit !== undefined) params.limit = input.limit;
    if (input.count !== undefined) params.count = input.count;

    const cacheArgs: Record<string, unknown> = { method: "serp.report", params };

    const result = await withCache(
      {
        toolName: "mutagen_api",
        accountId: null,
        args: cacheArgs,
        forceRefresh: input.force_refresh ?? false,
      },
      // serp.report always uses POST (handled inside executeMutagenMethod)
      () => executeMutagenMethod("serp.report", params),
    );

    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return errorToMcpContent(err);
  }
}

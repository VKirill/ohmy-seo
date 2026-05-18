import { getAccountByLabel } from "../lib/db/accounts-repo.js";
import { deleteWhere } from "@ohmy-seo/mcp-core/cache";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";
import { CACHEABLE_TOOLS } from "@ohmy-seo/mcp-core/cache";
// Valid tool values: yandex_metrika_api | yandex_webmaster_api | yandex_direct_api

export async function runInvalidateCache(input: {
  tool?: string;
  account?: string;
  older_than_hours?: number;
}) {
  try {
    const filters: { tool?: string; account_id?: number; fetched_at_before?: number } = {};
    if (input.tool) {
      if (!CACHEABLE_TOOLS.includes(input.tool as (typeof CACHEABLE_TOOLS)[number])) {
        throw new Error(`Unknown cacheable tool '${input.tool}'`);
      }
      filters.tool = input.tool;
    }
    if (input.account) {
      const acc = getAccountByLabel(input.account);
      if (!acc) throw new Error(`Account '${input.account}' not found`);
      filters.account_id = acc.id;
    }
    if (input.older_than_hours !== undefined) {
      if (
        typeof input.older_than_hours !== "number" ||
        input.older_than_hours <= 0
      ) {
        throw new Error("older_than_hours must be positive number");
      }
      const cutoff =
        Math.floor(Date.now() / 1000) - input.older_than_hours * 3600;
      filters.fetched_at_before = cutoff;
    }
    const deleted = deleteWhere(filters);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ deleted, filters: input }, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

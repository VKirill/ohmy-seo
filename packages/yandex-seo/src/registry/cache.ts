import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runInvalidateCache } from "../tools/invalidate-cache.js";
import { runCacheStats } from "../tools/cache-stats.js";
import { READ_ONLY } from "./_shared.js";

export function registerCache(server: McpServer): void {
  server.registerTool(
    "invalidate_cache",
    {
      title: "Cache — Invalidate Entries",
      description:
        "Deletes cached query results from the local SQLite cache. Filters are optional and combine with AND: " +
        "pass 'tool' to clear entries for a specific cacheable tool, 'account' to clear all entries for a connected " +
        "Yandex account, 'older_than_hours' to purge entries fetched more than N hours ago. Omit all filters to wipe " +
        "the entire query cache. Returns the count of deleted rows and the applied filters. Use this tool after " +
        "a site change or known Yandex data refresh to force the next call to fetch live results.",
      inputSchema: {
        tool: z
          .enum([
            "yandex_metrika_api",
            "yandex_webmaster_api",
            "yandex_direct_api",
          ])
          .optional()
          .describe("Restrict invalidation to a specific cacheable tool (optional)"),
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Restrict invalidation to entries for this account label (optional)"),
        older_than_hours: z
          .number()
          .positive()
          .optional()
          .describe("Delete only entries fetched more than this many hours ago (optional)"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runInvalidateCache({ tool: args.tool, account: args.account, older_than_hours: args.older_than_hours }),
  );

  server.registerTool(
    "cache_stats",
    {
      title: "Cache — Statistics",
      description:
        "Returns aggregate statistics about the local query result cache: total_entries (all rows), " +
        "db_size_bytes (SQLite file size on disk), top_tools (top-10 tools by entry count with hit totals), " +
        "and recent_24h (entries fetched within the last 24 hours). Use this tool to monitor cache growth " +
        "and determine whether a periodic invalidate_cache call is needed to free disk space.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => runCacheStats(),
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runListSites } from "../tools/list-sites.js";
import { runListCounters } from "../tools/list-counters.js";
import { runFindProperty } from "../tools/find-property.js";
import { runRefreshInventory } from "../tools/refresh-inventory.js";
import { READ_ONLY } from "./_shared.js";

export function registerInventory(server: McpServer): void {
  server.registerTool(
    "list_sites",
    {
      title: "Inventory — List Webmaster Sites",
      description:
        "Returns all Yandex Webmaster sites cached in the local inventory for every connected account " +
        "that has the webmaster:hostinfo scope. Each row includes host_id, ascii_host_url, unicode_host_url, " +
        "verified flag, main_mirror flag, indexed_pages count, fetched_at timestamp, and cache_age_seconds " +
        "(null if never refreshed). On a cold cache the tool triggers a live Yandex API fetch before returning. " +
        "Optionally filter to a single account by label.",
      inputSchema: {
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional; omit to list sites across all eligible accounts)"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runListSites({ account: args.account }),
  );

  server.registerTool(
    "list_counters",
    {
      title: "Inventory — List Metrika Counters",
      description:
        "Returns all Yandex Metrika counters cached in the local inventory for every connected account " +
        "that has the metrika:read scope. Each row includes counter_id, name, site, status, permission, " +
        "fetched_at timestamp, and cache_age_seconds (null if the cache was never populated). On a cold " +
        "cache the tool triggers a live Yandex API fetch before returning results. " +
        "Optionally filter to a single account by label.",
      inputSchema: {
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional; omit to list counters across all eligible accounts)"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runListCounters({ account: args.account }),
  );

  server.registerTool(
    "find_property",
    {
      title: "Inventory — Find Property by Query",
      description:
        "Searches the local inventory for Webmaster sites and/or Metrika counters matching the query " +
        "string using case-insensitive substring scoring: exact match = 100, starts-with = 80, contains = 50. " +
        "Returns up to 25 results sorted by score descending. On a cold cache the tool fetches from Yandex " +
        "before searching. Use kind='site' or kind='counter' to restrict the search. Ideal for resolving a " +
        "domain name or counter name to its canonical id before calling domain tools.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Search string; matched case-insensitively against site URLs, counter names, and counter IDs"),
        kind: z
          .enum(["site", "counter"])
          .optional()
          .describe("Restrict results to 'site' (Webmaster) or 'counter' (Metrika); omit to search both"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runFindProperty({ query: args.query, kind: args.kind }),
  );

  server.registerTool(
    "refresh_inventory",
    {
      title: "Inventory — Force Refresh",
      description:
        "Triggers an explicit refresh of the local inventory by fetching the latest sites or counters " +
        "from Yandex APIs and upserting the results into the database. Returns a per-(account, kind) report " +
        "with fetched, inserted, updated, removed counts, duration_ms, and any error message. Skips " +
        "account/kind pairs that lack the required OAuth scope. Use without arguments to refresh everything, " +
        "or pass account and/or kind to narrow the scope.",
      inputSchema: {
        account: z
          .string()
          .min(1)
          .optional()
          .describe("Account label from list_accounts (optional; omit to refresh all eligible accounts)"),
        kind: z
          .enum(["sites", "counters"])
          .optional()
          .describe("Which inventory kind to refresh: 'sites' (Webmaster) or 'counters' (Metrika); omit for both"),
      },
      annotations: READ_ONLY,
    },
    async (args) => runRefreshInventory({ account: args.account, kind: args.kind }),
  );
}

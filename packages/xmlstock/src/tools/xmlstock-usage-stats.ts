/**
 * xmlstock-usage-stats.ts — MCP tool: show cumulative XMLStock call counters.
 *
 * Not cached by design: stats are always read fresh from the local DB.
 */

import { getUsageStats } from "../lib/usage-counter.js";

export const xmlstockUsageStatsDescription =
  "Show cumulative XMLStock API call counts by engine and tool. " +
  "For live balance in RUB open the dashboard.";

export async function runXmlstockUsageStats() {
  const stats = getUsageStats();

  const result = {
    total_calls:   stats.total_calls,
    by_engine:     stats.by_engine,
    by_tool:       stats.by_tool,
    db_path:       stats.db_path,
    dashboard_url: "https://xmlstock.com/lk/",
    note:          "Для актуального баланса в рублях — откройте dashboard",
  };

  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

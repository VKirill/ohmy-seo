import { statSync } from "node:fs";
import { resolve } from "node:path";
import * as repo from "./query-cache-repo.js";

export function computeCacheStats() {
  const now = Math.floor(Date.now() / 1000);
  const since24h = now - 24 * 3600;
  const dbPath =
    process.env.MCP_YANDEX_SEO_DB_PATH ||
    resolve(process.cwd(), "data/state.db");
  let db_size_bytes = 0;
  try {
    db_size_bytes = statSync(dbPath).size;
  } catch {
    /* ignore */
  }
  return {
    total_entries: repo.countEntries(),
    db_size_bytes,
    db_path: dbPath,
    top_tools: repo.topByHits(10),
    recent_24h: repo.recentStats(since24h),
    computed_at: new Date(now * 1000).toISOString(),
  };
}

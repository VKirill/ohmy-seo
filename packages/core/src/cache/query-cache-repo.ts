import { getDb } from "../db/connection.js";

export type QueryCacheEntry = {
  args_hash: string;
  tool_name: string;
  account_namespace: string | null;
  account_id: number | null;
  args_json: string;
  response_json: string;
  fetched_at: number;
  expires_at: number;
  hit_count: number;
  last_hit_at: number | null;
};

export function getEntry(argsHash: string, packageName?: string): QueryCacheEntry | null {
  return (
    getDb(packageName)
      .prepare<[string], QueryCacheEntry>(
        `SELECT args_hash, tool_name, account_namespace, account_id, args_json, response_json,
                fetched_at, expires_at, hit_count, last_hit_at
         FROM query_cache WHERE args_hash = ?`
      )
      .get(argsHash) ?? null
  );
}

export function putEntry(entry: QueryCacheEntry, packageName?: string): void {
  getDb(packageName)
    .prepare(
      `INSERT OR REPLACE INTO query_cache
         (args_hash, tool_name, account_namespace, account_id, args_json, response_json,
          fetched_at, expires_at, hit_count, last_hit_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`
    )
    .run(
      entry.args_hash,
      entry.tool_name,
      entry.account_namespace ?? null,
      entry.account_id ?? null,
      entry.args_json,
      entry.response_json,
      entry.fetched_at,
      entry.expires_at
    );
}

export function incrementHit(argsHash: string, now: number, packageName?: string): void {
  getDb(packageName)
    .prepare(
      `UPDATE query_cache
       SET hit_count = hit_count + 1, last_hit_at = ?
       WHERE args_hash = ?`
    )
    .run(now, argsHash);
}

type DeleteFilter = {
  tool?: string;
  account_namespace?: string | null;
  account_id?: number | null;
  fetched_at_before?: number;
};

export function deleteWhere(filter: DeleteFilter, packageName?: string): number {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (filter.tool !== undefined) {
    parts.push("tool_name = ?");
    params.push(filter.tool);
  }
  if (filter.account_namespace !== undefined) {
    if (filter.account_namespace === null) {
      parts.push("account_namespace IS NULL");
    } else {
      parts.push("account_namespace = ?");
      params.push(filter.account_namespace);
    }
  }
  if (filter.account_id !== undefined) {
    if (filter.account_id === null) {
      parts.push("account_id IS NULL");
    } else {
      parts.push("account_id = ?");
      params.push(filter.account_id);
    }
  }
  if (filter.fetched_at_before !== undefined) {
    parts.push("fetched_at < ?");
    params.push(filter.fetched_at_before);
  }

  const where = parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "";
  const result = getDb(packageName)
    .prepare(`DELETE FROM query_cache${where}`)
    .run(...params);
  return result.changes;
}

export function deleteByEndpointPrefix(toolName: string, endpoint: string, packageName?: string): number {
  const exactPattern = `%"endpoint":${JSON.stringify(endpoint)}%`;
  const subPattern   = `%"endpoint":"${endpoint}/%`;
  const stmt = getDb(packageName).prepare(
    `DELETE FROM query_cache WHERE tool_name = ? AND (args_json LIKE ? OR args_json LIKE ?)`
  );
  return stmt.run(toolName, exactPattern, subPattern).changes;
}

export function countEntries(packageName?: string): number {
  const row = getDb(packageName)
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM query_cache")
    .get();
  return row?.n ?? 0;
}

export type ToolHitSummary = {
  tool_name: string;
  entries: number;
  total_hits: number;
};

export function topByHits(limit = 10, packageName?: string): ToolHitSummary[] {
  return getDb(packageName)
    .prepare<[number], ToolHitSummary>(
      `SELECT tool_name,
              COUNT(*) AS entries,
              SUM(hit_count) AS total_hits
       FROM query_cache
       GROUP BY tool_name
       ORDER BY SUM(hit_count) DESC
       LIMIT ?`
    )
    .all(limit);
}

export type RecentStats = {
  entries_created: number;
  hits_served: number;
};

export function recentStats(since: number, packageName?: string): RecentStats {
  const created = getDb(packageName)
    .prepare<[number], { n: number }>(
      "SELECT COUNT(*) AS n FROM query_cache WHERE fetched_at >= ?"
    )
    .get(since);
  const hits = getDb(packageName)
    .prepare<[number], { s: number | null }>(
      "SELECT SUM(hit_count) AS s FROM query_cache WHERE last_hit_at >= ?"
    )
    .get(since);
  return {
    entries_created: created?.n ?? 0,
    hits_served: hits?.s ?? 0,
  };
}

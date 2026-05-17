import { computeArgsHash, canonicalStringify } from "./cache-keys.js";
import * as repo from "./query-cache-repo.js";

export const CACHEABLE_TOOLS = [
  "wordstat_keywords",
  "mutagen_competition",
  "webmaster_top_queries",
  "metrika_search_phrases",
  "webmaster_indexing_issues",
  "webmaster_site_summary",
  "metrika_traffic_summary",
] as const;
export type CacheableTool = (typeof CACHEABLE_TOOLS)[number];

const TTL_DEFAULTS: Record<CacheableTool, number> = {
  wordstat_keywords:        7 * 24 * 3600,
  mutagen_competition:     30 * 24 * 3600,
  webmaster_top_queries:        1 * 3600,
  metrika_search_phrases:       1 * 3600,
  webmaster_indexing_issues:    1 * 3600,
  webmaster_site_summary:       6 * 3600,
  metrika_traffic_summary:      6 * 3600,
};

const ttlCache = new Map<CacheableTool, number>();

export function getTtlForTool(name: CacheableTool): number {
  if (ttlCache.has(name)) return ttlCache.get(name)!;
  const envKey = "MCP_YANDEX_SEO_CACHE_TTL_" + name.toUpperCase();
  const raw = process.env[envKey];
  const def = TTL_DEFAULTS[name];
  if (raw === undefined || raw === "") {
    ttlCache.set(name, def);
    return def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[warn] Invalid ${envKey}='${raw}', falling back to default ${def}s`);
    ttlCache.set(name, def);
    return def;
  }
  const result = Math.floor(n);
  ttlCache.set(name, result);
  return result;
}

export async function withCache<T>(
  opts: {
    toolName: CacheableTool;
    accountId: number | null;
    args: Record<string, unknown>;
    forceRefresh: boolean;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const hash = computeArgsHash(opts.toolName, opts.accountId, opts.args);
  const now = Math.floor(Date.now() / 1000);

  if (!opts.forceRefresh) {
    const entry = repo.getEntry(hash);
    if (entry && entry.expires_at > now) {
      repo.incrementHit(hash, now);
      return JSON.parse(entry.response_json) as T;
    }
  }

  const result = await fn(); // throws → no cache write
  const ttl = getTtlForTool(opts.toolName);
  const { force_refresh: _ignored, ...rest } = opts.args ?? {};
  const argsJson = canonicalStringify({ tool: opts.toolName, account_id: opts.accountId, args: rest });
  repo.putEntry({
    args_hash: hash,
    tool_name: opts.toolName,
    account_id: opts.accountId,
    args_json: argsJson,
    response_json: JSON.stringify(result),
    fetched_at: now,
    expires_at: now + ttl,
    hit_count: 0,
    last_hit_at: null,
  });
  return result;
}

// for tests
export function _clearTtlCache(): void {
  ttlCache.clear();
}

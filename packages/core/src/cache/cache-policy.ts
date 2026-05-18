import { computeArgsHash, canonicalStringify } from "./cache-keys.js";
import * as repo from "./query-cache-repo.js";

// ---------------------------------------------------------------------------
// Legacy closed-set (backward compat — yandex-seo still imports CacheableTool)
// ---------------------------------------------------------------------------

export const CACHEABLE_TOOLS = [
  "yandex_metrika_api",
  "yandex_webmaster_api",
  "yandex_direct_api",
  "mutagen_competition",
  "mutagen_api",
] as const;
export type CacheableTool = (typeof CACHEABLE_TOOLS)[number];

// ---------------------------------------------------------------------------
// Open registry API (Phase 2+)
// ---------------------------------------------------------------------------

export interface CacheableToolConfig {
  ttlSeconds?: number;
  ttlEnvKey?: string;          // e.g. 'MCP_XMLSTOCK_CACHE_TTL_SERP'
  ttlDefaultSeconds: number;
}

const registry = new Map<string, CacheableToolConfig>();

export function registerCacheableTool(toolName: string, cfg: CacheableToolConfig): void {
  registry.set(toolName, cfg);
}

export function getToolCacheConfig(toolName: string): CacheableToolConfig | undefined {
  return registry.get(toolName);
}

export function isCacheable(toolName: string): boolean {
  return registry.has(toolName);
}

// ---------------------------------------------------------------------------
// Backward-compat migration: auto-register legacy CACHEABLE_TOOLS on module load
// Maps the old MCP_YANDEX_SEO_CACHE_TTL_* env names into the registry.
// ---------------------------------------------------------------------------

const GENERIC_API_TOOLS = new Set<CacheableTool>(["yandex_metrika_api", "yandex_webmaster_api", "yandex_direct_api"]);

const TTL_DEFAULTS: Record<CacheableTool, number> = {
  yandex_metrika_api:   3600,
  yandex_webmaster_api: 3600,
  yandex_direct_api:    3600,
  mutagen_competition:  30 * 24 * 3600,
  mutagen_api:          30 * 24 * 3600,
};

for (const tool of CACHEABLE_TOOLS) {
  const envKey = GENERIC_API_TOOLS.has(tool)
    ? "MCP_YANDEX_SEO_CACHE_TTL_API"
    : "MCP_YANDEX_SEO_CACHE_TTL_" + tool.toUpperCase();
  registerCacheableTool(tool, {
    ttlEnvKey: envKey,
    ttlDefaultSeconds: TTL_DEFAULTS[tool],
  });
}

// ---------------------------------------------------------------------------
// TTL resolution (registry-based)
// ---------------------------------------------------------------------------

const ttlCache = new Map<string, number>();

export function getTtlForTool(name: string): number {
  if (ttlCache.has(name)) return ttlCache.get(name)!;

  const cfg = registry.get(name);
  if (!cfg) {
    // Unknown tool: return 0 (no caching)
    return 0;
  }

  // Explicit ttlSeconds wins
  if (cfg.ttlSeconds !== undefined) {
    ttlCache.set(name, cfg.ttlSeconds);
    return cfg.ttlSeconds;
  }

  const def = cfg.ttlDefaultSeconds;

  if (!cfg.ttlEnvKey) {
    ttlCache.set(name, def);
    return def;
  }

  const raw = process.env[cfg.ttlEnvKey];
  if (raw === undefined || raw === "") {
    ttlCache.set(name, def);
    return def;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[warn] Invalid ${cfg.ttlEnvKey}='${raw}', falling back to default ${def}s`);
    ttlCache.set(name, def);
    return def;
  }
  const result = Math.floor(n);
  ttlCache.set(name, result);
  return result;
}

// ---------------------------------------------------------------------------
// withCache — toolName widened to string for Phase 2+ packages
// ---------------------------------------------------------------------------

export async function withCache<T>(
  opts: {
    toolName: string;
    accountId: number | null;
    args: Record<string, unknown>;
    forceRefresh: boolean;
    skipCacheIf?: (result: T) => boolean;
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
  if (opts.skipCacheIf?.(result)) return result;
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

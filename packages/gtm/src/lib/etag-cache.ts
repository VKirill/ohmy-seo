/**
 * In-memory etag/fingerprint cache for GTM resources.
 *
 * GTM uses a `fingerprint` field in the response body (not HTTP ETag header)
 * as an optimistic concurrency token. This cache stores that value keyed by
 * resource path, with a 5-minute TTL.
 */

const TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry {
  etag: string;
  fetched_at: number; // Date.now()
}

const cache = new Map<string, CacheEntry>();

/**
 * Returns the cached etag/fingerprint for `path`, or undefined if not cached
 * or the entry is stale (> 5 minutes old). Stale entries are pruned on access.
 */
export function getEtag(path: string): string | undefined {
  const entry = cache.get(path);
  if (!entry) return undefined;

  if (Date.now() - entry.fetched_at > TTL_MS) {
    cache.delete(path);
    return undefined;
  }

  return entry.etag;
}

/**
 * Stores an etag/fingerprint for `path`. Overwrites any existing entry.
 */
export function setEtag(path: string, etag: string): void {
  cache.set(path, { etag, fetched_at: Date.now() });
}

/**
 * Removes the cached etag/fingerprint for `path` (e.g. after a successful
 * write that invalidates the cached value).
 */
export function clearEtag(path: string): void {
  cache.delete(path);
}

import {
  refreshSitesForAccount,
  refreshCountersForAccount,
  type RefreshReport,
} from "./refresher.js";
import * as repo from "../db/inventory-repo.js";
import type { InvSitePublic, InvCounterPublic } from "../db/inventory-repo.js";

const DEFAULT_TTL_HOURS = 24;

const mutexes = new Map<string, Promise<unknown>>();

export function getTtlSeconds(): number {
  const raw = process.env.MCP_YANDEX_SEO_CACHE_TTL_HOURS;
  if (raw === undefined) return DEFAULT_TTL_HOURS * 3600;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[warn] Invalid MCP_YANDEX_SEO_CACHE_TTL_HOURS='${raw}', falling back to ${DEFAULT_TTL_HOURS}h`);
    return DEFAULT_TTL_HOURS * 3600;
  }
  return Math.floor(n * 3600);
}

function key(accountId: number, kind: "sites" | "counters"): string {
  return `${accountId}:${kind}`;
}

export async function acquireAndRun<T>(
  accountId: number,
  kind: "sites" | "counters",
  fn: (id: number) => Promise<T>
): Promise<T> {
  const k = key(accountId, kind);
  const existing = mutexes.get(k);
  if (existing) return existing as Promise<T>;
  const promise = fn(accountId).finally(() => mutexes.delete(k));
  mutexes.set(k, promise);
  return promise;
}

export async function getSitesWithPolicy(accountId: number): Promise<InvSitePublic[]> {
  const meta = repo.getRefreshMeta(accountId, "sites");
  const rows = repo.listSites({ account_id: accountId });
  const ttl = getTtlSeconds();
  const now = Math.floor(Date.now() / 1000);

  const isColdMiss = meta == null || rows.length === 0;
  const isStale =
    meta != null &&
    meta.last_refresh_success_at != null &&
    now - meta.last_refresh_success_at > ttl;

  if (isColdMiss) {
    await acquireAndRun(accountId, "sites", refreshSitesForAccount);
    return repo.listSites({ account_id: accountId });
  }
  if (isStale) {
    acquireAndRun(accountId, "sites", refreshSitesForAccount).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[warn] async refresh sites failed for acc=${accountId}: ${msg}`);
    });
    return rows;
  }
  return rows;
}

export async function getCountersWithPolicy(accountId: number): Promise<InvCounterPublic[]> {
  const meta = repo.getRefreshMeta(accountId, "counters");
  const rows = repo.listCounters({ account_id: accountId });
  const ttl = getTtlSeconds();
  const now = Math.floor(Date.now() / 1000);

  const isColdMiss = meta == null || rows.length === 0;
  const isStale =
    meta != null &&
    meta.last_refresh_success_at != null &&
    now - meta.last_refresh_success_at > ttl;

  if (isColdMiss) {
    await acquireAndRun(accountId, "counters", refreshCountersForAccount);
    return repo.listCounters({ account_id: accountId });
  }
  if (isStale) {
    acquireAndRun(accountId, "counters", refreshCountersForAccount).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[warn] async refresh counters failed for acc=${accountId}: ${msg}`);
    });
    return rows;
  }
  return rows;
}

export async function refreshSitesExplicit(accountId: number): Promise<RefreshReport> {
  return acquireAndRun(accountId, "sites", refreshSitesForAccount);
}

export async function refreshCountersExplicit(accountId: number): Promise<RefreshReport> {
  return acquireAndRun(accountId, "counters", refreshCountersForAccount);
}

/** Clears the mutex map. Intended for use in unit tests only. */
export function _clearMutexes(): void {
  mutexes.clear();
}

import { getDb } from "./connection.js";

export type InvSiteRow = {
  id: number;
  account_id: number;
  host_id: string;
  ascii_host_url: string;
  unicode_host_url: string | null;
  verified: number;
  main_mirror: number;
  indexed_pages: number | null;
  fetched_at: number;
};
export type InvSitePublic = Omit<InvSiteRow, "id"> & { account_label?: string };

export type InvCounterRow = {
  id: number;
  account_id: number;
  counter_id: string;
  name: string | null;
  site: string | null;
  status: string | null;
  permission: string | null;
  fetched_at: number;
};
export type InvCounterPublic = Omit<InvCounterRow, "id"> & { account_label?: string };

export type RefreshMetaRow = {
  account_id: number;
  kind: "sites" | "counters";
  last_refresh_success_at: number | null;
  last_refresh_attempt_at: number | null;
  last_error: string | null;
};

export type SiteInput = {
  host_id: string;
  ascii_host_url: string;
  unicode_host_url?: string | null;
  verified?: number;
  main_mirror?: number;
  indexed_pages?: number | null;
};
export type CounterInput = {
  counter_id: string;
  name?: string | null;
  site?: string | null;
  status?: string | null;
  permission?: string | null;
};
type UpsertStats = { inserted: number; updated: number; removed: number };
type FilterOpts = { account_id?: number; account_filter?: number[] };

function whereClause(col: string, opts: FilterOpts): { frag: string; params: unknown[] } {
  if (opts.account_id !== undefined) return { frag: ` WHERE ${col} = ?`, params: [opts.account_id] };
  if (opts.account_filter?.length) {
    return { frag: ` WHERE ${col} IN (${opts.account_filter.map(() => "?").join(",")})`, params: opts.account_filter };
  }
  return { frag: "", params: [] };
}

export function listSites(opts: FilterOpts = {}): InvSitePublic[] {
  const { frag, params } = whereClause("s.account_id", opts);
  return getDb().prepare(
    `SELECT s.account_id, s.host_id, s.ascii_host_url, s.unicode_host_url,
            s.verified, s.main_mirror, s.indexed_pages, s.fetched_at,
            a.label AS account_label
     FROM inv_sites s LEFT JOIN accounts a ON a.id = s.account_id${frag}
     ORDER BY s.account_id, s.ascii_host_url`
  ).all(...params) as InvSitePublic[];
}
export function listAllSites(): InvSitePublic[] { return listSites(); }

export function upsertSitesForAccount(accountId: number, sites: SiteInput[]): UpsertStats {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  return db.transaction((): UpsertStats => {
    const existing = new Set(
      db.prepare<[number], { host_id: string }>("SELECT host_id FROM inv_sites WHERE account_id = ?")
        .all(accountId).map((r) => r.host_id)
    );
    const incoming = new Set(sites.map((s) => s.host_id));
    const stmt = db.prepare(
      `INSERT INTO inv_sites (account_id, host_id, ascii_host_url, unicode_host_url, verified, main_mirror, indexed_pages, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, host_id) DO UPDATE SET
         ascii_host_url = excluded.ascii_host_url, unicode_host_url = excluded.unicode_host_url,
         verified = excluded.verified, main_mirror = excluded.main_mirror,
         indexed_pages = excluded.indexed_pages, fetched_at = excluded.fetched_at`
    );
    let inserted = 0, updated = 0;
    for (const s of sites) {
      stmt.run(accountId, s.host_id, s.ascii_host_url, s.unicode_host_url ?? null,
        s.verified ?? 0, s.main_mirror ?? 0, s.indexed_pages ?? null, now);
      if (!existing.has(s.host_id)) inserted++; else updated++;
    }
    const toRemove = [...existing].filter((id) => !incoming.has(id));
    if (toRemove.length > 0) {
      db.prepare(`DELETE FROM inv_sites WHERE account_id = ? AND host_id IN (${toRemove.map(() => "?").join(",")})`)
        .run(accountId, ...toRemove);
    }
    return { inserted, updated, removed: toRemove.length };
  })();
}

export function deleteSitesForAccount(accountId: number): void {
  getDb().prepare<[number]>("DELETE FROM inv_sites WHERE account_id = ?").run(accountId);
}

export function listCounters(opts: FilterOpts = {}): InvCounterPublic[] {
  const { frag, params } = whereClause("c.account_id", opts);
  return getDb().prepare(
    `SELECT c.account_id, c.counter_id, c.name, c.site, c.status, c.permission, c.fetched_at,
            a.label AS account_label
     FROM inv_counters c LEFT JOIN accounts a ON a.id = c.account_id${frag}
     ORDER BY c.account_id, c.counter_id`
  ).all(...params) as InvCounterPublic[];
}
export function listAllCounters(): InvCounterPublic[] { return listCounters(); }

export function upsertCountersForAccount(accountId: number, counters: CounterInput[]): UpsertStats {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  return db.transaction((): UpsertStats => {
    const existing = new Set(
      db.prepare<[number], { counter_id: string }>("SELECT counter_id FROM inv_counters WHERE account_id = ?")
        .all(accountId).map((r) => r.counter_id)
    );
    const incoming = new Set(counters.map((c) => c.counter_id));
    const stmt = db.prepare(
      `INSERT INTO inv_counters (account_id, counter_id, name, site, status, permission, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, counter_id) DO UPDATE SET
         name = excluded.name, site = excluded.site, status = excluded.status,
         permission = excluded.permission, fetched_at = excluded.fetched_at`
    );
    let inserted = 0, updated = 0;
    for (const c of counters) {
      stmt.run(accountId, c.counter_id, c.name ?? null, c.site ?? null,
        c.status ?? null, c.permission ?? null, now);
      if (!existing.has(c.counter_id)) inserted++; else updated++;
    }
    const toRemove = [...existing].filter((id) => !incoming.has(id));
    if (toRemove.length > 0) {
      db.prepare(`DELETE FROM inv_counters WHERE account_id = ? AND counter_id IN (${toRemove.map(() => "?").join(",")})`)
        .run(accountId, ...toRemove);
    }
    return { inserted, updated, removed: toRemove.length };
  })();
}

export function getRefreshMeta(accountId: number, kind: "sites" | "counters"): RefreshMetaRow | null {
  return getDb().prepare<[number, string], RefreshMetaRow>(
    `SELECT account_id, kind, last_refresh_success_at, last_refresh_attempt_at, last_error
     FROM inv_refresh_meta WHERE account_id = ? AND kind = ?`
  ).get(accountId, kind) ?? null;
}

export function setRefreshMetaSuccess(accountId: number, kind: "sites" | "counters"): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO inv_refresh_meta (account_id, kind, last_refresh_success_at, last_refresh_attempt_at, last_error)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(account_id, kind) DO UPDATE SET
       last_refresh_success_at = excluded.last_refresh_success_at,
       last_refresh_attempt_at = excluded.last_refresh_attempt_at, last_error = NULL`
  ).run(accountId, kind, now, now);
}

export function setRefreshMetaError(accountId: number, kind: "sites" | "counters", errorMsg: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(
    `INSERT INTO inv_refresh_meta (account_id, kind, last_refresh_attempt_at, last_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, kind) DO UPDATE SET
       last_refresh_attempt_at = excluded.last_refresh_attempt_at, last_error = excluded.last_error`
  ).run(accountId, kind, now, errorMsg);
}

import { getHostsList } from "../webmaster-client.js";
import { getCountersList } from "../metrika-client.js";
import { getAccessToken } from "../oauth/token-broker.js";
import { getAccountById } from "../db/accounts-repo.js";
import {
  upsertSitesForAccount,
  upsertCountersForAccount,
  setRefreshMetaSuccess,
  setRefreshMetaError,
} from "../db/inventory-repo.js";
import { hasScope, SCOPES } from "../scopes.js";

export type RefreshReport = {
  account_label: string;
  kind: "sites" | "counters";
  fetched: number;
  inserted: number;
  updated: number;
  removed: number;
  duration_ms: number;
  error: string | null;
};

function emptyReport(
  account_label: string,
  kind: "sites" | "counters",
  duration_ms: number,
  error: string
): RefreshReport {
  return { account_label, kind, fetched: 0, inserted: 0, updated: 0, removed: 0, duration_ms, error };
}

export async function refreshSitesForAccount(accountId: number): Promise<RefreshReport> {
  const t0 = Date.now();
  const acc = getAccountById(accountId);
  if (!acc) {
    return emptyReport("unknown", "sites", Date.now() - t0, "Account not found");
  }
  const account_label = acc.label;
  if (!hasScope(acc.scopes_granted, SCOPES.WEBMASTER_HOSTINFO)) {
    return emptyReport(account_label, "sites", Date.now() - t0, "Account lacks webmaster:hostinfo scope");
  }
  if (acc.webmaster_user_id === null) {
    return emptyReport(account_label, "sites", Date.now() - t0, "Account has no webmaster_user_id (probe failed at connect)");
  }
  const webmasterUserId = String(acc.webmaster_user_id);
  try {
    const accessToken = await getAccessToken(accountId);
    const hosts = await getHostsList({ accessToken, webmasterUserId });
    const { inserted, updated, removed } = upsertSitesForAccount(
      accountId,
      hosts.map((h) => ({
        host_id: h.host_id,
        ascii_host_url: h.ascii_host_url,
        unicode_host_url: h.unicode_host_url ?? null,
        verified: h.verified ? 1 : 0,
        main_mirror: h.main_mirror ? 1 : 0,
        indexed_pages: null,
      }))
    );
    setRefreshMetaSuccess(accountId, "sites");
    return {
      account_label,
      kind: "sites",
      fetched: hosts.length,
      inserted,
      updated,
      removed,
      duration_ms: Date.now() - t0,
      error: null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e.message ?? String(e)) : String(e);
    setRefreshMetaError(accountId, "sites", msg);
    return emptyReport(account_label, "sites", Date.now() - t0, msg);
  }
}

export async function refreshCountersForAccount(accountId: number): Promise<RefreshReport> {
  const t0 = Date.now();
  const acc = getAccountById(accountId);
  if (!acc) {
    return emptyReport("unknown", "counters", Date.now() - t0, "Account not found");
  }
  const account_label = acc.label;
  if (!hasScope(acc.scopes_granted, SCOPES.METRIKA_READ)) {
    return emptyReport(account_label, "counters", Date.now() - t0, "Account lacks metrika:read scope");
  }
  try {
    const accessToken = await getAccessToken(accountId);
    const counters = await getCountersList({ accessToken });
    const { inserted, updated, removed } = upsertCountersForAccount(
      accountId,
      counters.map((c) => ({
        counter_id: c.counter_id,
        name: c.name ?? null,
        site: c.site ?? null,
        status: c.status ?? null,
        permission: c.permission ?? null,
      }))
    );
    setRefreshMetaSuccess(accountId, "counters");
    return {
      account_label,
      kind: "counters",
      fetched: counters.length,
      inserted,
      updated,
      removed,
      duration_ms: Date.now() - t0,
      error: null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? (e.message ?? String(e)) : String(e);
    setRefreshMetaError(accountId, "counters", msg);
    return emptyReport(account_label, "counters", Date.now() - t0, msg);
  }
}

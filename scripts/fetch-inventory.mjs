#!/usr/bin/env node
/*
 * Fetches host list (Webmaster) + counter list (Metrika) for every connected account.
 * Saves snapshot to data/inventory.json (gitignored — contains personal account data).
 * Idempotent: overwrites file each run.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   node scripts/fetch-inventory.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listAccounts, getAccountByLabel } from "../dist/lib/db/accounts-repo.js";
import { getAccessToken } from "../dist/lib/oauth/token-broker.js";
import { SCOPES, hasScope } from "../dist/lib/scopes.js";

const TIMEOUT = Number(process.env.HTTP_TIMEOUT_MS ?? 30000);

async function fetchJson(url, accessToken) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { Authorization: "OAuth " + accessToken, "User-Agent": "mcp-yandex-seo/0.2.0" },
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.message };
  } finally { clearTimeout(t); }
}

async function fetchSitesFor(acc) {
  if (!hasScope(acc.scopes_granted, SCOPES.WEBMASTER_HOSTINFO)) return [];
  if (!acc.webmaster_user_id) return [];
  const data = await fetchJson(
    `https://api.webmaster.yandex.net/v4/user/${acc.webmaster_user_id}/hosts`,
    acc.access_token,
  );
  if (data.error) return { error: data.error };
  return (data.hosts ?? []).map(h => ({
    host_id: h.host_id,
    ascii_host_url: h.ascii_host_url,
    unicode_host_url: h.unicode_host_url,
    verified: h.verified,
    main_mirror: h.main_mirror,
  }));
}

async function fetchCountersFor(acc) {
  if (!hasScope(acc.scopes_granted, SCOPES.METRIKA_READ)) return [];
  const data = await fetchJson(
    "https://api-metrika.yandex.net/management/v1/counters?per_page=200",
    acc.access_token,
  );
  if (data.error) return { error: data.error };
  return (data.counters ?? []).map(c => ({
    counter_id: c.id,
    name: c.name,
    site: c.site,
    status: c.status,
    type: c.type,
  }));
}

const summary = { fetched_at: new Date().toISOString(), accounts: [] };
for (const lite of listAccounts()) {
  const acc = getAccountByLabel(lite.label);     // get tokens
  const token = await getAccessToken(acc.id);    // auto-refresh if needed
  const accWithFresh = { ...acc, access_token: token };
  const sites = await fetchSitesFor(accWithFresh);
  const counters = await fetchCountersFor(accWithFresh);
  summary.accounts.push({
    label: acc.label,
    yandex_login: acc.yandex_login,
    scopes_granted: acc.scopes_granted,
    sites: sites,
    counters: counters,
  });
  console.error(`[ok] ${acc.label} (${acc.yandex_login}): sites=${Array.isArray(sites)?sites.length:'ERR'} counters=${Array.isArray(counters)?counters.length:'ERR'}`);
}

const outPath = resolve(process.cwd(), "data/inventory.json");
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.error(`\n[done] saved to ${outPath}`);
console.log(JSON.stringify({ accounts: summary.accounts.length, fetched_at: summary.fetched_at }));

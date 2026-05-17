import { AmbiguousSiteError } from "./errors.js";
import { listAllSites } from "./db/inventory-repo.js";

type SiteCandidate = {
  kind: "site";
  account_label: string;
  host_id: string;
  display: string;
  score: number;
  indexed_pages?: number | null;
};
type CounterCandidate = {
  kind: "counter";
  account_label: string;
  counter_id: string;
  display: string;
  score: number;
};
export type Candidate = SiteCandidate | CounterCandidate;

function scoreCandidate(queryLower: string, valueLower: string): number {
  if (!valueLower.includes(queryLower)) return 0;
  if (valueLower === queryLower) return 100;
  if (valueLower.startsWith(queryLower)) return 80;
  return 50;
}

export function findProperty({
  query,
  kind,
  sites,
  counters,
}: {
  query: string;
  kind?: "site" | "counter";
  sites: Array<{
    account_label?: string | null;
    host_id: string;
    ascii_host_url: string;
    unicode_host_url?: string | null;
    indexed_pages?: number | null;
  }>;
  counters: Array<{
    account_label?: string | null;
    counter_id: string;
    name?: string | null;
    site?: string | null;
  }>;
}): Candidate[] {
  const q = query.toLowerCase().trim();
  if (q.length === 0) return [];
  const results: Candidate[] = [];

  if (!kind || kind === "site") {
    for (const s of sites) {
      const score = Math.max(
        scoreCandidate(q, s.ascii_host_url.toLowerCase()),
        scoreCandidate(q, (s.unicode_host_url ?? "").toLowerCase())
      );
      if (score > 0) {
        results.push({
          kind: "site",
          account_label: s.account_label ?? "",
          host_id: s.host_id,
          display: s.unicode_host_url ?? s.ascii_host_url,
          score,
          indexed_pages: s.indexed_pages,
        });
      }
    }
  }

  if (!kind || kind === "counter") {
    for (const c of counters) {
      const score = Math.max(
        scoreCandidate(q, (c.name ?? "").toLowerCase()),
        scoreCandidate(q, (c.site ?? "").toLowerCase()),
        scoreCandidate(q, c.counter_id.toLowerCase())
      );
      if (score > 0) {
        results.push({
          kind: "counter",
          account_label: c.account_label ?? "",
          counter_id: c.counter_id,
          display: c.name ?? c.site ?? c.counter_id,
          score,
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 25);
}

export function pickUniqueSiteOrThrow(
  query: string,
  sites: Array<{
    account_label?: string | null;
    host_id: string;
    ascii_host_url: string;
    unicode_host_url?: string | null;
    indexed_pages?: number | null;
  }>,
  opts?: { accountLabel?: string }
): string {
  const filtered = opts?.accountLabel
    ? sites.filter((s) => s.account_label === opts.accountLabel)
    : sites;
  const matches = findProperty({ query, kind: "site", sites: filtered, counters: [] });
  if (matches.length === 0) {
    throw new Error(
      `No site matching '${query}'${opts?.accountLabel ? ` in account '${opts.accountLabel}'` : ""}. Run list_sites or refresh_inventory.`
    );
  }
  if (matches.length === 1) return (matches[0] as SiteCandidate).host_id;
  if (matches[0].score > matches[1].score) return (matches[0] as SiteCandidate).host_id;
  const tied = matches.filter((m) => m.score === matches[0].score);
  throw new AmbiguousSiteError(query, tied);
}

export function pickUniqueCounterOrThrow(
  query: string,
  counters: Array<{
    account_label?: string | null;
    counter_id: string;
    name?: string | null;
    site?: string | null;
  }>,
  opts?: { accountLabel?: string }
): string {
  const filtered = opts?.accountLabel
    ? counters.filter((c) => c.account_label === opts.accountLabel)
    : counters;
  const matches = findProperty({ query, kind: "counter", sites: [], counters: filtered });
  if (matches.length === 0) {
    throw new Error(
      `No counter matching '${query}'${opts?.accountLabel ? ` in account '${opts.accountLabel}'` : ""}. Run list_counters or refresh_inventory.`
    );
  }
  if (matches.length === 1) return (matches[0] as CounterCandidate).counter_id;
  if (matches[0].score > matches[1].score) return (matches[0] as CounterCandidate).counter_id;
  const tied = matches.filter((m) => m.score === matches[0].score);
  throw new AmbiguousSiteError(query, tied);
}

/**
 * If host_id appears in inv_sites under exactly one account_id → returns that account_id.
 * Otherwise (0 or 2+ owners) → null.
 * Does not trigger a refresh; cache-policy for inventory handles staleness.
 */
export function resolveAccountByHostId(hostId: string): number | null {
  const allSites = listAllSites();
  const matches = allSites.filter((s) => s.host_id === hostId);
  if (matches.length === 1) return matches[0].account_id;
  return null;
}

if (process.argv[2] === "smoke") {
  const sites = [
    { account_label: "a", host_id: "h1", ascii_host_url: "example.com" },
    { account_label: "b", host_id: "h2", ascii_host_url: "example.com" },
    { account_label: "a", host_id: "h3", ascii_host_url: "mysite.ru" },
  ];
  console.log(findProperty({ query: "example", sites, counters: [] }).length); // guardian: allow
  console.log(findProperty({ query: "example.com", sites, counters: [] })[0].score); // guardian: allow
  try {
    pickUniqueSiteOrThrow("example", sites);
    console.log("FAIL"); // guardian: allow
  } catch (e) {
    console.log(e instanceof AmbiguousSiteError ? "OK ambiguous" : "WRONG"); // guardian: allow
  }
  console.log(pickUniqueSiteOrThrow("mysite", sites)); // guardian: allow
}

import { listAccounts } from "../lib/db/accounts-repo.js";
import { getSitesWithPolicy, getCountersWithPolicy } from "../lib/inventory/cache-policy.js";
import { hasScope, SCOPES } from "../lib/scopes.js";
import { findProperty } from "../lib/property-resolver.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runFindProperty(args: {
  query: string;
  kind?: "site" | "counter";
}) {
  try {
    const allSites: Awaited<ReturnType<typeof getSitesWithPolicy>> = [];
    const allCounters: Awaited<ReturnType<typeof getCountersWithPolicy>> = [];
    for (const a of listAccounts()) {
      if (
        hasScope(a.scopes_granted, SCOPES.WEBMASTER_HOSTINFO) &&
        (!args.kind || args.kind === "site")
      ) {
        const rows = await getSitesWithPolicy(a.id);
        allSites.push(...rows);
      }
      if (
        hasScope(a.scopes_granted, SCOPES.METRIKA_READ) &&
        (!args.kind || args.kind === "counter")
      ) {
        const rows = await getCountersWithPolicy(a.id);
        allCounters.push(...rows);
      }
    }
    const results = findProperty({
      query: args.query,
      kind: args.kind,
      sites: allSites.map((s) => ({
        account_label: s.account_label ?? "",
        host_id: s.host_id,
        ascii_host_url: s.ascii_host_url,
        unicode_host_url: s.unicode_host_url,
        indexed_pages: s.indexed_pages,
      })),
      counters: allCounters.map((c) => ({
        account_label: c.account_label ?? "",
        counter_id: c.counter_id,
        name: c.name,
        site: c.site,
      })),
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { query: args.query, kind: args.kind, results, count: results.length },
            null,
            2
          ),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

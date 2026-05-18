import { getAccountByLabel, listAccounts } from "../lib/db/accounts-repo.js";
import { acquireAndRun } from "../lib/inventory/cache-policy.js";
import { refreshSitesForAccount, refreshCountersForAccount } from "../lib/inventory/refresher.js";
import { hasScope, SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runRefreshInventory(args: {
  account?: string;
  kind?: "sites" | "counters";
}) {
  try {
    const accs = args.account
      ? [getAccountByLabel(args.account)].filter(Boolean)
      : listAccounts();
    if (accs.length === 0) {
      throw new Error(
        `No account ${args.account ? `'${args.account}'` : "connected"}`
      );
    }
    const kinds = args.kind
      ? ([args.kind] as const)
      : (["sites", "counters"] as const);
    const reports = [];
    for (const a of accs) {
      if (!a) continue;
      for (const k of kinds) {
        if (k === "sites" && !hasScope(a.scopes_granted, SCOPES.WEBMASTER_HOSTINFO))
          continue;
        if (k === "counters" && !hasScope(a.scopes_granted, SCOPES.METRIKA_READ))
          continue;
        const fn =
          k === "sites" ? refreshSitesForAccount : refreshCountersForAccount;
        const report = await acquireAndRun(a.id, k, fn);
        reports.push(report);
      }
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ reports, count: reports.length }, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

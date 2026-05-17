import { getAccountByLabel, listAccounts } from "../lib/db/accounts-repo.js";
import { getSitesWithPolicy } from "../lib/inventory/cache-policy.js";
import * as repo from "../lib/db/inventory-repo.js";
import { hasScope, SCOPES } from "../lib/scopes.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runListSites(args: { account?: string }) {
  try {
    const accs = args.account
      ? [getAccountByLabel(args.account)].filter(
          (a) => a && hasScope(a.scopes_granted, SCOPES.WEBMASTER_HOSTINFO)
        )
      : listAccounts().filter((a) =>
          hasScope(a.scopes_granted, SCOPES.WEBMASTER_HOSTINFO)
        );
    const allRows: Array<ReturnType<typeof Object.assign>> = [];
    const now = Math.floor(Date.now() / 1000);
    for (const a of accs) {
      if (!a) continue;
      const rows = await getSitesWithPolicy(a.id);
      const meta = repo.getRefreshMeta(a.id, "sites");
      const cache_age_seconds =
        meta?.last_refresh_success_at != null
          ? now - meta.last_refresh_success_at
          : null;
      rows.forEach((r) => allRows.push({ ...r, cache_age_seconds }));
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ sites: allRows, count: allRows.length }, null, 2),
        },
      ],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

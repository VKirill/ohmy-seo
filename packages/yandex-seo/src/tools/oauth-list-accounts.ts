import { listAccounts } from "../lib/db/accounts-repo.js";
import { listDirectAccessBlocks } from "../lib/api/direct-access.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runListAccounts() {
  try {
    const blocks = listDirectAccessBlocks();
    // Direct logins that denied API access recently: Direct tools skip them until recheck_after.
    const accounts = listAccounts().map((account) => {
      const denied = blocks
        .filter((b) => b.account_id === account.id)
        .map((b) => ({
          client_login: b.client_login || null,
          error_code: b.error_code,
          error_detail: b.error_detail,
          blocked_since: new Date(b.blocked_at * 1000).toISOString(),
          recheck_after: new Date(b.recheck_after * 1000).toISOString(),
        }));
      return denied.length ? { ...account, direct_access_denied: denied } : account;
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ accounts }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

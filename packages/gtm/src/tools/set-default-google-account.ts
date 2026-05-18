import { findAccountByLabel, setDefaultAccount } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "gtm";

export async function runSetDefaultGoogleAccount(input: { account_label: string }) {
  try {
    const account = findAccountByLabel(PKG_NAME, input.account_label);
    if (!account) {
      throw new Error(`Account '${input.account_label}' not found. Run list_google_accounts.`);
    }
    setDefaultAccount(PKG_NAME, account.id);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ default_account: input.account_label }, null, 2),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

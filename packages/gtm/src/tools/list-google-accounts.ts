import { listAccounts } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "gtm";

export async function runListGoogleAccounts() {
  try {
    const accounts = listAccounts(PKG_NAME);
    return { content: [{ type: "text" as const, text: JSON.stringify({ accounts }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

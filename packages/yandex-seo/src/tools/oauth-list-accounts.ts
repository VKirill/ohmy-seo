import { listAccounts } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "../lib/errors.js";

export async function runListAccounts() {
  try {
    const accounts = listAccounts();
    return { content: [{ type: "text" as const, text: JSON.stringify({ accounts }, null, 2) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

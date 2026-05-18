import { deleteAccount } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runDeleteAccount(input: { label: string }) {
  try {
    deleteAccount(input.label);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: input.label }) }] };
  } catch (e) {
    return errorToMcpContent(e);
  }
}

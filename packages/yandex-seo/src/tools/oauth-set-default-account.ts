import { setDefault } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

export async function runSetDefaultAccount(input: { label: string }) {
  try {
    setDefault(input.label);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ default_account: input.label }) }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
